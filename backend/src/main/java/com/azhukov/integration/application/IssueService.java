package com.azhukov.integration.application;

import lombok.RequiredArgsConstructor;
import com.azhukov.integration.application.port.ReviewStore;
import com.azhukov.integration.application.port.TaskStore;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.domain.exchange.LocalSnapshot;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.review.Evidence;
import com.azhukov.integration.domain.review.Issue;
import com.azhukov.integration.domain.task.HistoryType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.util.Map;
import java.util.UUID;

/** Issue changes and their audit entries join the caller's exchange transaction. */
@Service
@Transactional(propagation=Propagation.MANDATORY)
@RequiredArgsConstructor
public class IssueService {
    private static final String DELAYED="Автоматическая доставка приостановлена: исчерпан лимит "
        + DeliveryAttempt.MAX_AUTOMATIC_ATTEMPTS + " попыток";
    private final ReviewStore issues;
    private final TaskStore tasks;

    public UUID open(ExchangeState state,UUID operationId,Issue.Kind kind,String reason,
                     Object content,OperationResult received,Long cursor) {
        var evidence=new Evidence(reason,cursor,state==null ? null : LocalSnapshot.of(state),received);
        var opened=issues.open(state==null ? null : state.task().id(),operationId,kind,reason,content,evidence);
        if (opened.created() && state!=null)
            tasks.history(state.task(),null,HistoryType.ISSUE_OPENED,reason,Map.of("issueId",opened.id()));
        return opened.id();
    }

    public void temporary(ExchangeState state,boolean delayed) {
        UUID existing=issues.temporary(state.task().id());
        if (existing!=null) {
            if (delayed) issues.delay(existing,DELAYED);
            return;
        }
        String reason=delayed ? DELAYED : "Получение операции исполнителем пока не подтверждено";
        open(state,state.task().operationId(),delayed ? Issue.Kind.DELIVERY_DELAYED : Issue.Kind.DELIVERY_UNCERTAIN,
            reason,reason,null,null);
    }

    public void exhausted(ExchangeState state,UUID lastAttempt) {
        temporary(state,true);
        var details=new java.util.LinkedHashMap<String,Object>();
        if (lastAttempt!=null) details.put("attemptId",lastAttempt);
        tasks.history(state.task(),null,HistoryType.DELIVERY_ATTEMPT,DELAYED,details);
    }

    public void confirm(ExchangeState state) {
        for (UUID id:issues.confirm(state.task().id()))
            tasks.history(state.task(),null,HistoryType.ISSUE_RESOLVED,
                "Получение подтверждено; проблема доставки закрыта",Map.of("issueId",id));
    }

    public UUID protocol(ExchangeState state,String reason,Object content) {
        UUID existing=issues.temporary(state.task().id());
        if (existing==null) return open(state,state.task().operationId(),Issue.Kind.PROTOCOL_ERROR,reason,content,null,null);
        issues.protocol(existing,reason,new Evidence(reason,null,LocalSnapshot.of(state),null));
        tasks.history(state.task(),null,HistoryType.ISSUE_OPENED,reason,Map.of("issueId",existing));
        return existing;
    }

    public void observe(ExchangeState state,OperationResult result) { issues.observe(state,result); }
}
