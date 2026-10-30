import { useEffect, useState } from "react";

import { listsRoomOnly, readSessionState } from "./session";

let known: Promise<boolean> | null = null;

export function useRoomOnly(): boolean {
  const [roomOnly, setRoomOnly] = useState(false);
  useEffect(() => {
    let alive = true;
    known ??= readSessionState().then(listsRoomOnly, () => false);
    void known.then((value) => { if (alive) setRoomOnly(value); });
    return () => { alive = false; };
  }, []);
  return roomOnly;
}
