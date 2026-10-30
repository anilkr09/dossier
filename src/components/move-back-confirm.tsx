"use client";

import { useState, type ReactNode } from "react";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { isMoveBack, statusInfo } from "@/lib/status";

import { ConfirmDialog } from "./ui/confirm-dialog";

type Confirm = (from: ApplicationStatus, to: ApplicationStatus, move: () => void) => void;

/**
 * Asks before an application goes back a stage, since that lowers how far
 * it counts in the dashboard's funnel. `confirm` moves at once when the
 * move goes forward; render `dialog` once, next to whatever calls it.
 */
export function useMoveBackConfirm(): [confirm: Confirm, dialog: ReactNode] {
  const [open, setOpen] = useState(false);
  // Kept while the dialog closes, so its text doesn't change as it fades out.
  const [pending, setPending] = useState<{ to: ApplicationStatus; move: () => void } | null>(null);

  const confirm: Confirm = (from, to, move) => {
    if (!isMoveBack(from, to)) return move();
    setPending({ to, move });
    setOpen(true);
  };

  const label = pending ? statusInfo(pending.to).label : "";
  const dialog = pending && (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={`Move back to ${label}?`}
      description={
        pending.to === ApplicationStatus.DRAFT
          ? "It will count as not sent: it leaves your dashboard's funnel and its sent date is cleared. Undo on the toast puts it back."
          : `Your dashboard's funnel will count it as reaching ${label} and no further. Undo on the toast puts it back.`
      }
      confirmLabel={`Move back to ${label}`}
      onConfirm={pending.move}
    />
  );
  return [confirm, dialog];
}
