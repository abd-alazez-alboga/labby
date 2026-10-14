import { useLocalSearchParams } from "expo-router";
import React from "react";

import ChatScreen from "../../../screens/chat/chat-screen";

export default function ChatRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  return <ChatScreen rideId={String(rideId)} />;
}
