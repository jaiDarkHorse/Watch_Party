package com.syncwatch.websocket;

import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class SignalingHandler extends TextWebSocketHandler 
{

    private final List<WebSocketSession> clients = new ArrayList<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception 
    {
    	
        if (clients.size() >= 2) 
        {
            session.close();
            System.out.println("Connection rejected: Watch Party is full");
            return;
        }

        clients.add(session);
        System.out.println("Client connected: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session,TextMessage message)throws Exception 
    {

        String payload = message.getPayload();

        System.out.println("Received: " + payload);

        // Broadcast message to other clients
        for (WebSocketSession client : clients) 
        {
            if (client.isOpen() && !client.getId().equals(session.getId())) 
            {
                client.sendMessage(new TextMessage(payload));
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, org.springframework.web.socket.CloseStatus status) 
    {
        clients.remove(session);
        System.out.println("Client disconnected: "+ session.getId());
    }
}