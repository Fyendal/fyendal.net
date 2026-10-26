import type { FriendPresence } from "@fyendal/shared";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";

/** The signed-in account's friendship with one other player. Friends and
 * incoming requests carry the server's canonical username. */
export type FriendRelation =
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "outgoing" }
  | { kind: "incoming"; username: string }
  | { kind: "friend"; username: string; presence: FriendPresence };

export function useFriendRelation(username: string | null): FriendRelation {
  const { authUser, friends, requests } = useStore(useShallow((state) => ({
    authUser: state.authUser,
    friends: state.friends,
    requests: state.friendRequests,
  })));
  const key = username?.toLowerCase();
  if (key === undefined || !authUser || authUser.toLowerCase() === key) return { kind: "unavailable" };
  const friend = friends.find((candidate) => candidate.username.toLowerCase() === key);
  if (friend) return { kind: "friend", username: friend.username, presence: friend.presence };
  const request = requests.find((candidate) => candidate.username.toLowerCase() === key);
  if (request?.direction === "incoming") return { kind: "incoming", username: request.username };
  return request ? { kind: "outgoing" } : { kind: "none" };
}
