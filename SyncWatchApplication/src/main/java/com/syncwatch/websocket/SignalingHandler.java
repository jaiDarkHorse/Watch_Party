package com.syncwatch.websocket;

import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

@Component
public class SignalingHandler extends AbstractWebSocketHandler {

    private WebSocketSession hostSession;

    private final Set<WebSocketSession> viewers = new CopyOnWriteArraySet<>();


    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        System.out.println("WebSocket connected: " + session.getId());
    }


    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();

        System.out.println("Received TEXT from " + session.getId() + ": " + payload);


        if (payload.equals("HOST")) {
            hostSession = session;

            System.out.println("Client registered as HOST");

            session.sendMessage(new TextMessage("HOST_REGISTERED"));

            return;
        }


        if (payload.equals("VIEWER")) {
            viewers.add(session);

            System.out.println("Client registered as VIEWER");

            session.sendMessage(new TextMessage("VIEWER_REGISTERED"));

            if (hostSession != null && hostSession.isOpen()) {
                hostSession.sendMessage(new TextMessage("VIEWER_READY"));

                System.out.println("Notified HOST: VIEWER_READY");
            }

            return;
        }


        if (payload.startsWith("VIDEO_READY:") || payload.startsWith("AUDIO_READY:")) {
            System.out.println("Viewer finished processing: " + payload);

            if (hostSession != null && hostSession.isOpen()) {
                hostSession.sendMessage(new TextMessage(payload));

                System.out.println("Sent to HOST: " + payload);
            }

            return;
        }


        if (session.equals(hostSession)) {
            for (WebSocketSession viewer : viewers) {
                if (viewer.isOpen()) {
                    viewer.sendMessage(new TextMessage(payload));
                }
            }
        }
    }


    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) throws Exception {
        int size = message.getPayloadLength();

        System.out.println("Received BINARY from " + session.getId() + ": " + size + " bytes");


        if (!session.equals(hostSession)) {
            System.out.println("Binary message rejected: sender is not HOST");

            return;
        }


        byte[] data = new byte[message.getPayloadLength()];

        message.getPayload().get(data);

        System.out.println("Copied binary data: " + data.length + " bytes");


        for (WebSocketSession viewer : viewers) {
            if (viewer.isOpen()) {
                System.out.println("Sending binary to viewer: " + viewer.getId());

                viewer.sendMessage(new BinaryMessage(data));

                System.out.println("Binary sent to viewer: " + data.length + " bytes");
            }
        }
    }


    @Override
    public void afterConnectionClosed(WebSocketSession session, org.springframework.web.socket.CloseStatus status) {
        System.out.println("WebSocket disconnected: " + session.getId());

        if (session.equals(hostSession)) {
            hostSession = null;

            System.out.println("HOST disconnected");
        }

        viewers.remove(session);
    }
}