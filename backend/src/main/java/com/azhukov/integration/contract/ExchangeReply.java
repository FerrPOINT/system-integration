package com.azhukov.integration.contract;

import tools.jackson.databind.JsonNode;

public record ExchangeReply(int status, JsonNode body, boolean connectionFailed) {}
