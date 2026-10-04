package com.labby.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Owner-operated SMS gateway (ES-01). All environments send real SMS — there is no bypass.
 *
 * @param gatewayUrl HTTP endpoint of the gateway app
 * @param gatewayToken bearer token for the gateway (env only, never committed)
 */
@ConfigurationProperties(prefix = "labby.sms")
public record SmsProperties(String gatewayUrl, String gatewayToken) {}
