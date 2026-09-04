import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";

export function PostGameFriendAction({ username }: { username: string }) {
  const intl = useIntl();
  const { authUser, friends, requests, sendRequest, respondRequest, openChat } = useStore(useShallow((state) => ({
    authUser: state.authUser,
    friends: state.friends,
    requests: state.friendRequests,
    sendRequest: state.sendFriendRequest,
    respondRequest: state.respondFriendRequest,
    openChat: state.openChat,
  })));
  if (!authUser || authUser.toLowerCase() === username.toLowerCase()) return null;
  const key = username.toLowerCase();
  const friend = friends.find((candidate) => candidate.username.toLowerCase() === key);
  const request = requests.find((candidate) => candidate.username.toLowerCase() === key);
  if (friend) return <button type="button" onClick={() => openChat(friend.username)}>{intl.formatMessage({ id: "social.message" })}</button>;
  if (request?.direction === "incoming") {
    return <button type="button" onClick={() => respondRequest(request.username, true)}>{intl.formatMessage({ id: "social.acceptFriend" })}</button>;
  }
  if (request) return <button type="button" disabled>{intl.formatMessage({ id: "social.requestSent" })}</button>;
  return <button type="button" onClick={() => sendRequest(username)}>{intl.formatMessage({ id: "social.addFriend" })}</button>;
}
