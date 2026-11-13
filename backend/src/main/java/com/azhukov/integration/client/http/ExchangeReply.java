package com.azhukov.integration.client.http;

import tools.jackson.databind.JsonNode;

public record ExchangeReply(int status, JsonNode body, boolean connectionFailed) {}
