import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { UiIcon, type UiIconName } from "../components/UiIcon.js";
import { useFriendRelation, type FriendRelation } from "../social/friendRelation.js";
import { useStore } from "../store.js";

type Shown = Exclude<FriendRelation["kind"], "unavailable">;

const ICON: Readonly<Record<Shown, UiIconName>> = {
  none: "user-add",
  outgoing: "user-pending",
  incoming: "user-add",
  friend: "message",
};

const LABEL: Readonly<Record<Shown, string>> = {
  none: "social.addFriend",
  outgoing: "social.requestSent",
  incoming: "social.acceptFriend",
  friend: "social.message",
};

const NAMED_LABEL: Readonly<Record<Shown, string>> = {
  none: "game.opponent.addFriend",
  outgoing: "game.opponent.requestPending",
  incoming: "game.opponent.respondFriend",
  friend: "social.messageNamed",
};

/** Carries the friendship with a league opponent from stranger to chat; the
 * label is the state, so no confirmation is needed. */
export function LeagueFriendAction({ username }: { username: string }) {
  const intl = useIntl();
  const relation = useFriendRelation(username);
  const { sendRequest, respondRequest, openChat } = useStore(useShallow((state) => ({
    sendRequest: state.sendFriendRequest,
    respondRequest: state.respondFriendRequest,
    openChat: state.openChat,
  })));
  if (relation.kind === "unavailable") return null;
  const name = "username" in relation ? relation.username : username;
  const act = () => {
    if (relation.kind === "friend") openChat(name);
    else if (relation.kind === "incoming") respondRequest(name, true);
    else if (relation.kind === "none") sendRequest(name);
  };
  return (
    <button
      type="button"
      className="league-friend-action"
      data-relation={relation.kind}
      disabled={relation.kind === "outgoing"}
      aria-label={intl.formatMessage({ id: NAMED_LABEL[relation.kind] }, { username: name })}
      onClick={act}
    >
      <UiIcon name={ICON[relation.kind]} />
      {intl.formatMessage({ id: LABEL[relation.kind] })}
    </button>
  );
}
