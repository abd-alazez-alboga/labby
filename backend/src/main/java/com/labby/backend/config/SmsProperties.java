package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Owner-operated SMS gateway (ES-01). All environments send real SMS — there is no bypass.
 *
 * @param gatewayUrl HTTP endpoint of the gateway (Traccar cloud relay or the phone's local API)
 * @param gatewayToken API token for the gateway, sent raw in the Authorization header (env only,
 *     never committed)
 */
@ConfigurationProperties(prefix = "labby.sms")
public record SmsProperties(String gatewayUrl, String gatewayToken) {}
