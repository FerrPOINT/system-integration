package com.azhukov.integration.tasks;

import com.azhukov.integration.support.PostgresTest;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

class DatabaseAvailabilityTest extends PostgresTest {
    @Autowired DataSource dataSource;

    @Test
    void exhaustedPoolReturnsUnavailableWithoutChangingRightsOrLosingTheCommand() throws Exception {
        var creator=login("initiator.one");
        var operator=login("operator");
        var original=created(creator,UUID.randomUUID());
        var key=UUID.randomUUID();
        var held=new ArrayList<Connection>();
        try {
            int size=dataSource.unwrap(HikariDataSource.class).getMaximumPoolSize();
            for (int n=0;n<size;n++) held.add(dataSource.getConnection());
            var unavailable=create(creator,key,CREATE);
            status(503,unavailable);
            assertEquals("SERVICE_UNAVAILABLE",body(unavailable).get("code").asString());
            assertFalse(unavailable.getResponse().getContentAsString().contains("JDBC"));
            status(503,mvc.perform(get("/api/tasks/"+original).session(creator.session())).andReturn());
            status(403,create(operator,UUID.randomUUID(),CREATE));
        } finally {
            for (var connection:held) connection.close();
        }
        assertEquals(1,count("tasks"),"An unavailable transaction must not partially create a task");
        status(200,mvc.perform(get("/api/tasks/"+original).session(creator.session())).andReturn());
        var recovered=create(creator,key,CREATE);
        status(201,recovered);
        var replay=create(creator,key,CREATE);
        status(201,replay);
        assertEquals(body(recovered),body(replay));
        assertEquals(2,count("tasks"));
    }
}
