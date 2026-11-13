package com.azhukov.integration.tasks;

import com.azhukov.integration.contract.ExchangeReply;
import com.azhukov.integration.application.Actor;
import com.azhukov.integration.contract.external.model.OperationState;
import com.azhukov.integration.contract.external.model.Result;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.contract.ExchangeProtocol;
import com.azhukov.integration.domain.RuleViolation;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static com.azhukov.integration.contract.internal.model.Issue.AllowedActionsEnum.*;

@Service
public class OperationsTransactions {
    private final TaskRepository tasks;
    private final ExchangeIssues issues;
    private final ExchangeTasks exchange;
    private final CommandReceipts commands;
    private final ObjectMapper json;
    private final ExchangeProtocol protocol;

    public OperationsTransactions(TaskRepository tasks,ExchangeIssues issues,ExchangeTasks exchange,
                                  CommandReceipts commands,ObjectMapper json) {
        this.tasks=tasks; this.issues=issues; this.exchange=exchange; this.commands=commands; this.json=json;
        this.protocol=new ExchangeProtocol(json);
    }

    @Transactional(readOnly=true)
    public TaskRepository.ExchangeTask snapshot(Actor user,UUID task) {
        requireOperator(user);
        return tasks.exchange(tasks.get(task,user,false).operationId(),false);
    }

    @Transactional(readOnly=true)
    public Issue get(Actor user,UUID id) { requireOperator(user); return view(context(id,user,false),user); }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    public IssuePage list(Actor user,int page,IssueStatus status) {
        requireOperator(user);
        if (page < 0) throw RuleViolation.invalid("Номер страницы не может быть отрицательным");
        var rows=issues.list(page,status);
        long total=issues.count(status);
        long pages=(total+19)/20;
        var states=tasks.exchangeByTask(rows.stream().map(row -> row.value().getTaskId()).filter(Objects::nonNull).distinct().toList());
        var snapshots=issues.reconciliations(rows.stream().map(row -> row.value().getLatestReconciliationId()).filter(Objects::nonNull).distinct().toList());
        var items=rows.stream().map(row -> {
            var taskId=row.value().getTaskId();
            var state=taskId==null ? null : states.get(taskId);
            var snapshotId=row.value().getLatestReconciliationId();
            var snapshot=snapshotId==null ? null : snapshots.get(snapshotId);
            if ((taskId!=null && state==null) || (snapshotId!=null && snapshot==null) ||
                (snapshot!=null && !snapshot.value().getTaskId().equals(taskId)))
                throw RuleViolation.notFound();
            return view(new Context(row,state,snapshot),user);
        }).toList();
        return new IssuePage(items,page,(long)page+1<pages,total,pages);
    }

    @Transactional(readOnly=true)
    public Reconciliation reconciliation(Actor user,UUID task,UUID id) {
        requireOperator(user);
        tasks.get(task,user,false);
        return issues.reconciliation(task,id).value();
    }

    @Transactional
    public Reconciliation saveReconciliation(Actor user,UUID key,TaskRepository.ExchangeTask before,ExchangeReply reply) {
        requireOperator(user);
        return commands.execute(user.id(),"RECONCILE",key,before.task().id(),200,Reconciliation.class,() -> {
            var current=tasks.exchange(before.task().operationId(),true);
            if (current.version()!=before.version()) throw stale();
            OperationState external=null;
            String protocolFailure=null;
            var availability=Reconciliation.ExternalAvailabilityEnum.UNAVAILABLE;
            if (ExchangeProtocol.missingOperation(reply.status(),reply.body()))
                availability=Reconciliation.ExternalAvailabilityEnum.NOT_FOUND;
            else if (reply.status()>=400 && reply.status()<500) protocolFailure="Сверка получила некорректный постоянный ответ HTTP "+reply.status();
            if (reply.status()==200) {
                try { external=protocol.state(reply.body()); availability=Reconciliation.ExternalAvailabilityEnum.PRESENT; }
                catch (IllegalArgumentException invalid) { protocolFailure="Сверка получила некорректный внешний снимок"; }
            }
            var outcome=availability==Reconciliation.ExternalAvailabilityEnum.UNAVAILABLE ? Reconciliation.OutcomeEnum.UNAVAILABLE :
                matches(current,external) ? Reconciliation.OutcomeEnum.MATCH : Reconciliation.OutcomeEnum.DIFFERENCE;
            UUID issue=issues.active(current.task().id());
            if (protocolFailure!=null) issue=issues.open(current,current.task().operationId(),"PROTOCOL_ERROR",
                protocolFailure,reply.body(),null,null);
            if (outcome==Reconciliation.OutcomeEnum.DIFFERENCE && issue==null) {
                issue=issues.open(current,current.task().operationId(),"RECONCILIATION_DIFFERENCE",
                    "Сверка обнаружила расхождение с внешней системой",java.util.Arrays.asList(issues.snapshot(current),external),null,null);
            }
            var saved=new Reconciliation(UUID.randomUUID(),current.task().id(),current.task().operationId(),
                OffsetDateTime.now(ZoneOffset.UTC),user.id(),outcome,json.convertValue(issues.snapshot(current),LocalSnapshot.class),availability)
                .issueId(issue);
            if (external!=null) saved.external(external);
            issues.saveReconciliation(saved,current.version());
            tasks.history(current.task(),user.id(),HistoryEvent.TypeEnum.RECONCILED,"Сверка: "+outcome.getValue(),
                Map.of("reconciliationId",saved.getReconciliationId()));
            return saved;
        });
    }

    @Transactional
    public Issue take(Actor user,UUID key,UUID id,TakeIssueRequest input) {
        requireOperator(user);
        return commands.execute(user.id(),"TAKE_ISSUE",key,new Target(id,input),200,Issue.class,() -> {
            var context=context(id,user,true);
            version(context,input.getExpectedIssueRevision());
            requireAction(context,user,TAKE_OWNERSHIP);
            UUID previous=context.issue().value().getAssignedTo();
            issues.assign(id,user.id());
            var details=new LinkedHashMap<String,Object>();
            details.put("issueId",id); details.put("assignedTo",user.id());
            if (previous!=null) details.put("previousAssigneeId",previous);
            tasks.history(context.state().task(),user.id(),HistoryEvent.TypeEnum.RESPONSIBILITY_CHANGED,
                previous==null ? "Оператор взял разбор на себя" : "Разбор передан другому оператору",details);
            return view(context(id,user,false),user);
        });
    }

    @Transactional
    public Issue retry(Actor user,UUID key,UUID id,RetryRequest input) {
        requireOperator(user);
        return commands.execute(user.id(),"RETRY_EXCHANGE",key,new Target(id,input),200,Issue.class,() -> {
            var context=context(id,user,true);
            version(context,input.getExpectedIssueRevision());
            boolean protocolError=context.issue().value().getKind()==Issue.KindEnum.PROTOCOL_ERROR;
            if (protocolError) requireFresh(context,input.getReconciliationId());
            requireAction(context,user,RETRY);
            var queue=tasks.lockQueue(context.state().task().operationId());
            if (queue.claim()!=null) throw notAllowed();
            tasks.scheduleRetry(context.state().task().operationId(),protocolError ? "GET" : queue.step(),0);
            if (protocolError) {
                tasks.delivery(context.state().task().operationId(),DeliveryStatus.UNKNOWN);
                issues.resumeProtocol(id);
            } else issues.advanceRevision(id);
            var details=new LinkedHashMap<String,Object>(); details.put("issueId",id);
            if (input.getReconciliationId()!=null) details.put("reconciliationId",input.getReconciliationId());
            tasks.history(context.state().task(),user.id(),HistoryEvent.TypeEnum.RETRY_QUEUED,
                "Повтор назначен оператором: "+input.getReason(),details);
            return view(context(id,user,false),user);
        });
    }

    @Transactional
    public IssueResolution resolve(Actor user,UUID key,UUID id,ResolveIssueRequest input) {
        requireOperator(user);
        return commands.execute(user.id(),"RESOLVE_ISSUE",key,new Target(id,input),200,IssueResolution.class,() -> {
            var context=context(id,user,true);
            version(context,input.getExpectedIssueRevision());
            requireFresh(context,input.getReconciliationId());
            requireAction(context,user,Issue.AllowedActionsEnum.fromValue(input.getAction().getValue()));
            var resolution=new IssueResolution(id,input.getReconciliationId(),input.getAction(),input.getReason(),user.id(),OffsetDateTime.now(ZoneOffset.UTC));
            // Close the target first so common result application closes only other temporary issues.
            issues.resolve(id,resolution);
            if (input.getAction()==ResolutionAction.APPLY_EXTERNAL_RESULT) {
                exchange.apply(context.state(),(Result)external(context).getResult(),user.id());
            } else if (context.issue().value().getKind()==Issue.KindEnum.PROTOCOL_ERROR &&
                context.state().task().deliveryStatus()==DeliveryStatus.NEEDS_REVIEW) {
                tasks.delivery(context.state().task().operationId(),DeliveryStatus.STOPPED);
                tasks.removeQueue(context.state().task().operationId());
            }
            tasks.history(context.state().task(),user.id(),HistoryEvent.TypeEnum.ISSUE_RESOLVED,
                "Решение оператора: "+input.getReason(),Map.of("issueId",id,"reconciliationId",input.getReconciliationId()));
            return resolution;
        });
    }

    private record Context(ExchangeIssues.StoredIssue issue,TaskRepository.ExchangeTask state,ExchangeIssues.SavedReconciliation reconciliation) {}
    private record Target(UUID id,Object input) {}

    private Context context(UUID id,Actor user,boolean lock) { return context(issues.get(id,false),user,lock); }

    private Context context(ExchangeIssues.StoredIssue original,Actor user,boolean lock) {
        var task=original.value().getTaskId();
        if (task==null) return new Context(original,null,null);
        var record=tasks.get(task,user,lock);
        var state=tasks.exchange(record.operationId(),false);
        var row=lock ? issues.get(original.value().getIssueId(),true) : original;
        var reconciliation=row.value().getLatestReconciliationId()==null ? null : issues.reconciliation(task,row.value().getLatestReconciliationId());
        return new Context(row,state,reconciliation);
    }

    private Issue view(Context context,Actor user) { return context.issue().value().allowedActions(actions(context,user)); }

    private List<Issue.AllowedActionsEnum> actions(Context context,Actor user) {
        var issue=context.issue().value();
        if (issue.getStatus()!=IssueStatus.OPEN || context.state()==null) return List.of();
        var actions=new ArrayList<Issue.AllowedActionsEnum>();
        if (!user.id().equals(issue.getAssignedTo())) actions.add(TAKE_OWNERSHIP);
        actions.add(RECONCILE);
        if (issue.getKind()==Issue.KindEnum.DELIVERY_DELAYED && context.issue().queueFree()) actions.add(RETRY);
        var external=fresh(context) ? external(context) : null;
        boolean protocolError=issue.getKind()==Issue.KindEnum.PROTOCOL_ERROR;
        if (protocolError && context.state().task().deliveryStatus()==DeliveryStatus.NEEDS_REVIEW && context.issue().queueFree() && fresh(context) &&
            context.reconciliation().value().getExternalAvailability()!=Reconciliation.ExternalAvailabilityEnum.UNAVAILABLE &&
            (external==null || (sameIdentity(context.state(),external) && external.getExecutions().getValue()==0))) actions.add(RETRY);
        boolean reviewKind=protocolError || issue.getKind()==Issue.KindEnum.RESULT_CONFLICT || issue.getKind()==Issue.KindEnum.RECONCILIATION_DIFFERENCE;
        if (reviewKind && fresh(context) && context.reconciliation().value().getOutcome()!=Reconciliation.OutcomeEnum.UNAVAILABLE) {
            actions.add(ACKNOWLEDGE_DIFFERENCE);
            if (external!=null && sameIdentity(context.state(),external) && external.getResult() instanceof Result result &&
                result.getVersion()==Result.VersionEnum.NUMBER_2 &&
                (context.state().result()==null || result.getVersion().getValue()>context.state().result().getVersion().getValue())) actions.add(APPLY_EXTERNAL_RESULT);
        }
        return actions;
    }

    private boolean fresh(Context context) {
        return context.reconciliation()!=null && context.reconciliation().exchangeVersion()==context.state().version();
    }

    private OperationState external(Context context) {
        var value=context.reconciliation().value().getExternal();
        return value==null ? null : protocol.state(json.valueToTree(value));
    }

    private boolean matches(TaskRepository.ExchangeTask state,OperationState external) {
        if (external==null) return state.task().deliveryStatus()!=DeliveryStatus.ACKNOWLEDGED && state.result()==null;
        return sameIdentity(state,external) && state.task().deliveryStatus()==DeliveryStatus.ACKNOWLEDGED && Objects.equals(state.result(),external.getResult());
    }

    private boolean sameIdentity(TaskRepository.ExchangeTask state,OperationState external) {
        return external.getOperationId().equals(state.task().operationId()) && external.getRequest().equals(ExchangeTasks.input(state));
    }

    private void requireFresh(Context context,UUID id) {
        if (id==null || !id.equals(context.issue().value().getLatestReconciliationId()) || !fresh(context)) throw stale();
    }
    private void requireAction(Context context,Actor user,Issue.AllowedActionsEnum action) {
        if (!actions(context,user).contains(action)) throw notAllowed();
    }
    private static void version(Context context,long expected) {
        if (context.issue().value().getIssueRevision()!=expected)
            throw new RuleViolation(RuleViolation.Code.ISSUE_REVISION_CONFLICT,"Проблема уже изменена. Обновите карточку");
    }
    private static void requireOperator(Actor user) {
        if (!user.isOperator()) throw new RuleViolation(RuleViolation.Code.ACCESS_DENIED,"Действие доступно оператору");
    }
    private static RuleViolation stale() { return new RuleViolation(RuleViolation.Code.SNAPSHOT_STALE,"Сверка устарела. Выполните новую сверку"); }
    private static RuleViolation notAllowed() { return new RuleViolation(RuleViolation.Code.ACTION_NOT_ALLOWED,"Действие недоступно в текущем состоянии"); }
}
