import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import {
  buildComposerActionView,
  buildPermissionCardView,
  createPermissionCardFeedback,
  getPermissionRequestKey
} from "./session-workbench-conversation";

const pendingPermissionRequest: NonNullable<
  SessionSnapshot["context"]["pendingPermissionRequest"]
> = {
  toolCallId: "tool-call-1",
  toolName: "list_directory",
  toolInput: {
    path: "."
  },
  family: "workspace-file",
  permissionProfile: "always-ask-user",
  summaryText: "需要你的确认后才能执行高风险工具：list_directory",
  createdAt: "2026-04-23T15:47:00.000Z"
};

describe("permission card feedback", () => {
  test("keeps the request card visible before the user responds", () => {
    const view = buildPermissionCardView({
      pendingPermissionRequest,
      feedback: null,
      submitting: false
    });

    expect(view).not.toBeNull();
    expect(view?.tone).toBe("pending");
    expect(view?.showActions).toBe(true);
    expect(view?.title).toBe("Permission Request");
  });

  test("shows immediate approved feedback after allow is clicked", () => {
    const feedback = createPermissionCardFeedback(
      pendingPermissionRequest,
      "本会话允许 tool:list_directory"
    );

    const view = buildPermissionCardView({
      pendingPermissionRequest,
      feedback,
      submitting: true
    });

    expect(feedback?.tone).toBe("approved");
    expect(view?.tone).toBe("approved");
    expect(view?.showActions).toBe(false);
    expect(view?.title).toBe("已同意");
    expect(view?.detailText).toBeUndefined();
  });

  test("keeps approved feedback available immediately after the request clears", () => {
    const feedback = createPermissionCardFeedback(
      pendingPermissionRequest,
      "本会话允许 tool:list_directory"
    );

    const view = buildPermissionCardView({
      pendingPermissionRequest: null,
      feedback,
      submitting: false
    });

    expect(view?.key).toBe(getPermissionRequestKey(pendingPermissionRequest));
    expect(view?.tone).toBe("approved");
    expect(view?.title).toBe("已同意");
    expect(view?.detailText).toBeUndefined();
  });

  test("hides approved feedback once the permission request key is cleared", () => {
    const feedback = createPermissionCardFeedback(
      pendingPermissionRequest,
      "本会话允许 tool:list_directory"
    );

    const viewWhilePending = buildPermissionCardView({
      pendingPermissionRequest,
      feedback,
      submitting: false
    });
    const viewAfterClear = buildPermissionCardView({
      pendingPermissionRequest: null,
      feedback,
      submitting: false
    });

    expect(viewWhilePending?.tone).toBe("approved");
    expect(viewAfterClear?.tone).toBe("approved");
  });

  test("shows rejected feedback when the user cancels", () => {
    const feedback = createPermissionCardFeedback(
      pendingPermissionRequest,
      "取消"
    );

    const view = buildPermissionCardView({
      pendingPermissionRequest,
      feedback,
      submitting: true
    });

    expect(feedback?.tone).toBe("rejected");
    expect(view?.tone).toBe("rejected");
    expect(view?.title).toBe("已取消");
    expect(view?.detailText).toBeUndefined();
  });
});

describe("composer action view", () => {
  test("switches the send button to stop while the run is active", () => {
    const view = buildComposerActionView({
      canInterrupt: true,
      interrupting: false,
      canSubmit: false
    });

    expect(view.buttonType).toBe("interrupt");
    expect(view.disabled).toBe(false);
    expect(view.buttonLabel).toBe("停止执行");
  });

  test("shows stopping feedback in the same button after interrupt is requested", () => {
    const view = buildComposerActionView({
      canInterrupt: true,
      interrupting: true,
      canSubmit: false
    });

    expect(view.buttonType).toBe("interrupt");
    expect(view.disabled).toBe(true);
    expect(view.buttonLabel).toBe("停止中...");
  });

  test("falls back to the send button when there is no active run", () => {
    const view = buildComposerActionView({
      canInterrupt: false,
      interrupting: false,
      canSubmit: true
    });

    expect(view.buttonType).toBe("submit");
    expect(view.disabled).toBe(false);
    expect(view.buttonLabel).toBe("发送");
  });
});
