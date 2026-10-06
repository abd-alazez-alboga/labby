package com.labby.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;

/**
 * Enables raw WebSocket endpoints (M6 realtime channel). Handlers register their own paths by
 * implementing {@code WebSocketConfigurer} (the {@code /api/v1/realtime} socket lives in the
 * controller layer, which no other layer may reference).
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig {}
