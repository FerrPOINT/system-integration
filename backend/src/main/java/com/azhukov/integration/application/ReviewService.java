package com.azhukov.integration.application;

import com.azhukov.integration.application.port.TaskStore;
import com.azhukov.integration.application.port.ReviewStore;
import com.azhukov.integration.application.port.CommandReceiptStore;
import com.azhukov.integration.application.port.CommandReceiptStore.Command;
import com.azhukov.integration.application.port.ExternalExchange.Lookup;
import com.azhukov.integration.application.review.IssueCommands;
import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.LocalSnapshot;
import com.azhukov.integration.domain.review.*;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.task.HistoryType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static com.azhukov.integration.domain.review.Issue.Action.*;

@Service
public class ReviewService {
    private final TaskStore tasks;
    private final ReviewStore issues;
    private final IssueService issueChanges;
    private final ExchangeTasks exchange;
    private final CommandReceiptStore commands;

    public ReviewService(TaskStore tasks,ReviewStore issues,IssueService issueChanges,
                                  ExchangeTasks exchange,CommandReceiptStore commands) {
        this.tasks=tasks; this.issues=issues; this.issueChanges=issueChanges; this.exchange=exchange; this.commands=commands;
    }

    public record ReconciliationStart(ExchangeState before,Reconciliation replay) {}

    @Transactional(readOnly=true)
    public ReconciliationStart prepareReconciliation(Actor user,UUID task,UUID key) {
        requireOperator(user);
        var record=tasks.get(task,user,false);
        var saved=commands.replay(user.id(),Command.RECONCILE,key,task,Reconciliation.class);
        if (saved.isPresent()) return new ReconciliationStart(null,saved.get());
        return new ReconciliationStart(tasks.exchange(record.operationId(),false),null);
    }

    @Transactional(readOnly=true)
    public Issue get(Actor user,UUID id) { requireOperator(user); return loadContext(id,user,false).view(user.id()); }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    public Page<Issue> list(Actor user,int page,Issue.Status status) {
        requireOperator(user);
        if (page<0) throw RuleViolation.invalid("Номер страницы не может быть отрицательным");
        var rows=issues.list(page,status);
        long total=issues.count(status);
        var states=tasks.exchangeByTask(rows.stream().map(row -> row.value().taskId()).filter(Objects::nonNull).distinct().toList());
        var snapshots=issues.reconciliations(rows.stream().map(row -> row.value().latestReconciliationId()).filter(Objects::nonNull).distinct().toList());
        var items=rows.stream().map(row -> {
            var taskId=row.value().taskId();
            var state=taskId==null ? null : states.get(taskId);
            var snapshotId=row.value().latestReconciliationId();
            var saved=snapshotId==null ? null : snapshots.get(snapshotId);
            if ((taskId!=null && state==null) || (snapshotId!=null && saved==null) ||
                (saved!=null && !saved.value().taskId().equals(taskId))) throw RuleViolation.notFound();
            return toContext(row,state,saved).view(user.id());
        }).toList();
        return new Page<>(items,page,total);
    }

    @Transactional(readOnly=true)
    public Reconciliation reconciliation(Actor user,UUID task,UUID id) {
        requireOperator(user);
        tasks.get(task,user,false);
        return issues.reconciliation(task,id).value();
    }

    @Transactional
    public Reconciliation saveReconciliation(Actor user,UUID key,ExchangeState before,Lookup reply) {
        requireOperator(user);
        return commands.execute(user.id(),Command.RECONCILE,key,before.task().id(),Reconciliation.class,() -> {
            var current=tasks.exchange(before.task().operationId(),true);
            if (current.version()!=before.version()) throw ReviewContext.stale();
            var external=reply.external();
            var availability=reply.availability();
            var outcome=availability==Reconciliation.Availability.UNAVAILABLE ? Reconciliation.Outcome.UNAVAILABLE :
                ReviewContext.matches(current,external) ? Reconciliation.Outcome.MATCH : Reconciliation.Outcome.DIFFERENCE;
            UUID issue=issues.active(current.task().id());
            if (reply.protocolFailure()!=null) issue=issueChanges.open(current,current.task().operationId(),Issue.Kind.PROTOCOL_ERROR,
                reply.protocolFailure(),reply.evidence(),null,null);
            if (outcome==Reconciliation.Outcome.DIFFERENCE && issue==null)
                issue=issueChanges.open(current,current.task().operationId(),Issue.Kind.RECONCILIATION_DIFFERENCE,
                    "Сверка обнаружила расхождение с внешней системой",java.util.Arrays.asList(LocalSnapshot.of(current),external),null,null);
            var saved=new Reconciliation(UUID.randomUUID(),current.task().id(),current.task().operationId(),
                OffsetDateTime.now(ZoneOffset.UTC),user.id(),outcome,LocalSnapshot.of(current),availability,external,issue);
            issues.saveReconciliation(saved,current.version());
            tasks.history(current.task(),user.id(),HistoryType.RECONCILED,"Сверка: "+outcome.name(),
                Map.of("reconciliationId",saved.reconciliationId()));
            return saved;
        });
    }

    @Transactional
    public Issue take(Actor user,UUID key,UUID id,IssueCommands.Take input) {
        requireOperator(user);
        return commands.execute(user.id(),Command.TAKE_ISSUE,key,new Target(id,input),Issue.class,() -> {
            var context=loadContext(id,user,true);
            context.requireRevision(input.expectedIssueRevision());
            context.requireAction(user.id(),TAKE_OWNERSHIP);
            UUID previous=context.issue().assignedTo();
            issues.assign(id,user.id());
            var details=new LinkedHashMap<String,Object>();
            details.put("issueId",id); details.put("assignedTo",user.id());
            if (previous!=null) details.put("previousAssigneeId",previous);
            tasks.history(context.state().task(),user.id(),HistoryType.RESPONSIBILITY_CHANGED,
                previous==null ? "Оператор взял разбор на себя" : "Разбор передан другому оператору",details);
            return loadContext(id,user,false).view(user.id());
        });
    }

    @Transactional
    public Issue retry(Actor user,UUID key,UUID id,IssueCommands.Retry input) {
        requireOperator(user);
        return commands.execute(user.id(),Command.RETRY_EXCHANGE,key,new Target(id,input),Issue.class,() -> {
            var context=loadContext(id,user,true);
            context.requireRevision(input.expectedIssueRevision());
            boolean protocolError=context.issue().kind()==Issue.Kind.PROTOCOL_ERROR;
            if (protocolError) context.requireFresh(input.reconciliationId());
            context.requireAction(user.id(),RETRY);
            var queue=tasks.lockQueue(context.state().task().operationId());
            if (queue.claim()!=null)
                throw new RuleViolation(RuleViolation.Code.ACTION_NOT_ALLOWED,"Действие недоступно в текущем состоянии");
            tasks.scheduleRetry(context.state().task().operationId(),protocolError ? "GET" : queue.step(),0);
            if (protocolError) {
                tasks.delivery(context.state().task().operationId(),DeliveryStatus.UNKNOWN);
                issues.resumeProtocol(id);
            } else issues.advanceRevision(id);
            var details=new LinkedHashMap<String,Object>(); details.put("issueId",id);
            if (input.reconciliationId()!=null) details.put("reconciliationId",input.reconciliationId());
            tasks.history(context.state().task(),user.id(),HistoryType.RETRY_QUEUED,
                "Повтор назначен оператором: "+input.reason(),details);
            return loadContext(id,user,false).view(user.id());
        });
    }

    @Transactional
    public IssueResolution resolve(Actor user,UUID key,UUID id,IssueCommands.Resolve input) {
        requireOperator(user);
        return commands.execute(user.id(),Command.RESOLVE_ISSUE,key,new Target(id,input),IssueResolution.class,() -> {
            var context=loadContext(id,user,true);
            context.requireRevision(input.expectedIssueRevision());
            context.requireFresh(input.reconciliationId());
            context.requireAction(user.id(),Issue.Action.valueOf(input.action().name()));
            var resolution=new IssueResolution(id,input.reconciliationId(),input.action(),input.reason(),user.id(),OffsetDateTime.now(ZoneOffset.UTC));
            // Close the target first so common result application closes only other temporary issues.
            issues.resolve(id,resolution);
            if (input.action()==IssueResolution.Action.APPLY_EXTERNAL_RESULT)
                exchange.apply(context.state(),context.external().result(),user.id());
            else if (context.issue().kind()==Issue.Kind.PROTOCOL_ERROR &&
                context.state().task().deliveryStatus()==DeliveryStatus.NEEDS_REVIEW) {
                tasks.delivery(context.state().task().operationId(),DeliveryStatus.STOPPED);
                tasks.removeQueue(context.state().task().operationId());
            }
            tasks.history(context.state().task(),user.id(),HistoryType.ISSUE_RESOLVED,
                "Решение оператора: "+input.reason(),Map.of("issueId",id,"reconciliationId",input.reconciliationId()));
            return resolution;
        });
    }

    private record Target(UUID id,Object input) {}

    private ReviewContext loadContext(UUID id,Actor user,boolean lock) {
        var original=issues.get(id,false);
        var task=original.value().taskId();
        if (task==null) return toContext(original,null,null);
        var record=tasks.get(task,user,lock);
        var state=tasks.exchange(record.operationId(),false);
        var row=lock ? issues.get(id,true) : original;
        var saved=row.value().latestReconciliationId()==null ? null : issues.reconciliation(task,row.value().latestReconciliationId());
        return toContext(row,state,saved);
    }

    private static ReviewContext toContext(ReviewStore.StoredIssue issue,ExchangeState state,ReviewStore.SavedReconciliation saved) {
        return new ReviewContext(issue.value(),issue.queueFree(),state,saved==null ? null : saved.value(),saved==null ? null : saved.exchangeVersion());
    }

    private static void requireOperator(Actor user) {
        if (!user.isOperator()) throw new RuleViolation(RuleViolation.Code.ACCESS_DENIED,"Действие доступно оператору");
    }
}
