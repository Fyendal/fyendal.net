import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { useFriendRelation } from "./friendRelation.js";

export function PostGameFriendAction({ username }: { username: string }) {
  const intl = useIntl();
  const relation = useFriendRelation(username);
  const { sendRequest, respondRequest, openChat } = useStore(useShallow((state) => ({
    sendRequest: state.sendFriendRequest,
    respondRequest: state.respondFriendRequest,
    openChat: state.openChat,
  })));
  if (relation.kind === "unavailable") return null;
  if (relation.kind === "friend") {
    return <button type="button" onClick={() => openChat(relation.username)}>{intl.formatMessage({ id: "social.message" })}</button>;
  }
  if (relation.kind === "incoming") {
    return <button type="button" onClick={() => respondRequest(relation.username, true)}>{intl.formatMessage({ id: "social.acceptFriend" })}</button>;
  }
  if (relation.kind === "outgoing") return <button type="button" disabled>{intl.formatMessage({ id: "social.requestSent" })}</button>;
  return <button type="button" className="post-game-friend-add" onClick={() => sendRequest(username)}>{intl.formatMessage({ id: "social.addFriend" })}</button>;
}
