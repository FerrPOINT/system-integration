package com.azhukov.integration.infrastructure.http;

import tools.jackson.databind.JsonNode;

public record ExchangeReply(int status, JsonNode body, boolean connectionFailed) {}
