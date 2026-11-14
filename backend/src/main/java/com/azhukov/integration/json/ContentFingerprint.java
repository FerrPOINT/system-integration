package com.azhukov.integration.json;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import tools.jackson.databind.ObjectMapper;

public final class ContentFingerprint {
    private ContentFingerprint() {}

    public static String of(ObjectMapper json, Object content) {
        Object plain = json.convertValue(content, Object.class);
        return text(json.writeValueAsString(normalize(plain)));
    }

    public static String text(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }

    private static Object normalize(Object value) {
        if (value instanceof Map<?,?> map) {
            var ordered = new TreeMap<String,Object>();
            map.forEach((key,item) -> ordered.put((String) key, normalize(item)));
            return ordered;
        }
        if (value instanceof List<?> list) return list.stream().map(ContentFingerprint::normalize).toList();
        return value;
    }
}
