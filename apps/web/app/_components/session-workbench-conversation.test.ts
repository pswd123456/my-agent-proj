import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import {
  buildBackgroundNotificationCopy,
  getBackgroundNotificationCardLabel,
  getBackgroundNotificationHeadline,
  buildPermissionQuickReplies,
  buildComposerActionView,
  buildConfirmationCardView,
  getCompactToolFileChangeRows,
  buildPermissionCardView,
  buildUserQuestionCardView,
  buildUserQuestionReplyMessage,
  getConfirmationKey,
  getUnifiedDiffLineTone,
  getWorkspaceFileChangeRows,
  createPermissionCardFeedback,
  getPermissionRequestKey,
  getUserQuestionKey
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

const pendingUserQuestionPayload: NonNullable<
  SessionSnapshot["context"]["pendingUserQuestionPayload"]
> = {
  questions: [
    {
      questionText: "这次计划要覆盖 CLI 还是 Web workbench？",
      options: [
        {
          label: "先做 CLI",
          reply: "先做 CLI",
          description: "先把 runtime 和 tool 行为跑通",
          isRecommended: true
        },
        {
          label: "CLI + Web",
          reply: "CLI + Web",
          description: "同时补完整前端交互"
        },
        {
          label: "补充说明",
          reply: "这会影响当前 plan mode 的交付边界。",
          description: "这会影响当前 plan mode 的交付边界。"
        }
      ],
      allowCancel: true
    }
  ],
  createdAt: "2026-04-26T09:00:00.000Z"
};

const pendingConfirmationPayload: NonNullable<
  SessionSnapshot["context"]["pendingConfirmationPayload"]
> = {
  summaryText: "请确认是否覆盖原有日程",
  proposedItems: [
    {
      previewText: "创建 04-27 09:00-10:00 的新日程：项目站会"
    }
  ],
  conflictItems: [
    {
      routineId: "routine-1",
      previewText: "04-27 09:00-09:30 已有日程：晨会"
    }
  ],
  contextNote: "确认后会先删除冲突项，再创建新的安排。",
  createdAt: "2026-04-27T08:00:00.000Z"
};

describe("permission card feedback", () => {
  test("uses the workspace escape quick reply for sandbox approvals", () => {
    expect(
      buildPermissionQuickReplies({
        ...pendingPermissionRequest,
        allowWorkspaceEscape: true
      })
    ).toEqual([
      {
        label: "本会话允许 workspace 外文件操作",
        reply: "本会话允许 workspace 外文件操作"
      }
    ]);
  });

  test("offers four shell approval scopes when the command is long enough", () => {
    expect(
      buildPermissionQuickReplies({
        ...pendingPermissionRequest,
        toolName: "run_shell_command",
        toolInput: {
          command: "git status --short origin/main"
        }
      })
    ).toEqual([
      {
        label: "本会话允许 shell:git *",
        reply: "本会话允许 shell:git *"
      },
      {
        label: "本会话允许 shell:git status *",
        reply: "本会话允许 shell:git status *"
      },
      {
        label: "本会话允许 shell:git status --short *",
        reply: "本会话允许 shell:git status --short *"
      },
      {
        label: "本会话允许 shell:git status --short origin/main",
        reply: "本会话允许 shell:git status --short origin/main"
      }
    ]);
  });

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

  test("moves long shell commands into detail text instead of stretching the summary", () => {
    const command =
      "cd /Users/boneda/gitrepo/my-agent-proj/apps && pwd && ls -la && git status --short";

    const view = buildPermissionCardView({
      pendingPermissionRequest: {
        ...pendingPermissionRequest,
        toolName: "run_shell_command",
        toolInput: { command },
        summaryText: `需要你的确认后才能执行 shell 命令：${command}`
      },
      feedback: null,
      submitting: false
    });

    expect(view?.summaryText).toBe("需要你的确认后才能执行 shell 命令");
    expect(view?.detailText).toBe(command);
    expect(view?.showActions).toBe(true);
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

  test("keeps shell command detail text in feedback state", () => {
    const command =
      "cd /Users/boneda/gitrepo/my-agent-proj/apps && pwd && ls -la && git status --short";
    const request = {
      ...pendingPermissionRequest,
      toolName: "run_shell_command" as const,
      toolInput: { command },
      summaryText: `需要你的确认后才能执行 shell 命令：${command}`
    };

    const feedback = createPermissionCardFeedback(
      request,
      "本会话允许 shell:cd /Users/boneda/gitrepo/my-agent-proj/apps *"
    );
    const view = buildPermissionCardView({
      pendingPermissionRequest: request,
      feedback,
      submitting: true
    });

    expect(feedback?.summaryText).toBe("需要你的确认后才能执行 shell 命令");
    expect(feedback?.detailText).toBe(command);
    expect(view?.detailText).toBe(command);
    expect(view?.tone).toBe("approved");
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

describe("compact tool file change rows", () => {
  test("formats file names and +/- line counts for collapsed tool cards", () => {
    expect(
      getCompactToolFileChangeRows({
        fileChanges: [
          {
            path: "apps/web/app/page.tsx",
            action: "modify",
            addedLineCount: 5,
            removedLineCount: 3,
            diff: "--- apps/web/app/page.tsx\n+++ apps/web/app/page.tsx"
          }
        ]
      })
    ).toEqual([
      {
        path: "apps/web/app/page.tsx",
        action: "modify",
        countsLabel: "+5 / -3",
        diff: "--- apps/web/app/page.tsx\n+++ apps/web/app/page.tsx"
      }
    ]);
  });
});

describe("background notification copy", () => {
  test("deduplicates identical summary and content text", () => {
    expect(
      buildBackgroundNotificationCopy({
        summary: "子代理已完成目录检查。",
        content: "子代理已完成目录检查。"
      })
    ).toEqual({
      summaryText: "子代理已完成目录检查。",
      contentText: null
    });
  });

  test("keeps the detailed child output when it differs from the summary", () => {
    expect(
      buildBackgroundNotificationCopy({
        summary: "子代理已完成目录检查。",
        content:
          "子代理已完成目录检查。\n\n发现 apps、packages、docs 三个核心目录。"
      })
    ).toEqual({
      summaryText: "子代理已完成目录检查。",
      contentText:
        "子代理已完成目录检查。\n\n发现 apps、packages、docs 三个核心目录。"
    });
  });
});

describe("background notification messaging", () => {
  test("keeps the consumed subagent wording unchanged", () => {
    expect(
      getBackgroundNotificationCardLabel({
        taskKind: "subagent",
        isConsumed: true
      })
    ).toBe("子代理反馈");
    expect(
      getBackgroundNotificationHeadline({
        kind: "task_completed",
        title: "后台子任务",
        taskKind: "subagent",
        isConsumed: true
      })
    ).toBe("主代理接受了子代理的反馈");
  });

  test("uses background-task wording for consumed shell notifications", () => {
    expect(
      getBackgroundNotificationCardLabel({
        taskKind: "shell_command",
        isConsumed: true
      })
    ).toBe("后台任务");
    expect(
      getBackgroundNotificationHeadline({
        kind: "task_completed",
        title: "后台任务",
        taskKind: "shell_command",
        isConsumed: true
      })
    ).toBe("后台任务已完成");
  });
});

describe("workspace file change rows", () => {
  test("formats line deltas and preserves diff text", () => {
    expect(
      getWorkspaceFileChangeRows([
        {
          path: "apps/web/app/page.tsx",
          action: "modify",
          addedLineCount: 7,
          removedLineCount: 5,
          diff: "--- a/apps/web/app/page.tsx\n+++ b/apps/web/app/page.tsx"
        }
      ])
    ).toEqual([
      {
        path: "apps/web/app/page.tsx",
        action: "modify",
        countsLabel: "+7 / -5",
        diff: "--- a/apps/web/app/page.tsx\n+++ b/apps/web/app/page.tsx"
      }
    ]);
  });

  test("classifies unified diff lines for visual highlighting", () => {
    expect(getUnifiedDiffLineTone("diff --git a/a.ts b/a.ts")).toBe("header");
    expect(getUnifiedDiffLineTone("--- a/apps/web/app/page.tsx")).toBe(
      "header"
    );
    expect(getUnifiedDiffLineTone("+++ b/apps/web/app/page.tsx")).toBe(
      "header"
    );
    expect(getUnifiedDiffLineTone("@@ -1,2 +1,3 @@")).toBe("hunk");
    expect(getUnifiedDiffLineTone("+const next = true;")).toBe("add");
    expect(getUnifiedDiffLineTone("-const prev = true;")).toBe("remove");
    expect(getUnifiedDiffLineTone(" const same = true;")).toBe("context");
  });
});

describe("user question card", () => {
  test("builds a clarification card from the pending payload", () => {
    const view = buildUserQuestionCardView(pendingUserQuestionPayload);

    expect(view?.key).toBe(getUserQuestionKey(pendingUserQuestionPayload));
    expect(view?.questions).toHaveLength(1);
    expect(view?.questions[0]?.questionText).toBe(
      "这次计划要覆盖 CLI 还是 Web workbench？"
    );
    expect(view?.questions[0]?.options).toHaveLength(3);
    expect(view?.questions[0]?.options[0]?.isRecommended).toBe(true);
    expect(view?.questions[0]?.allowCancel).toBe(true);
  });

  test("returns null when there is no pending clarification", () => {
    expect(buildUserQuestionCardView(null)).toBeNull();
    expect(getUserQuestionKey(null)).toBeNull();
  });

  test("keeps per-question cancel settings", () => {
    const view = buildUserQuestionCardView({
      ...pendingUserQuestionPayload,
      questions: pendingUserQuestionPayload.questions.map((question) => ({
        ...question,
        allowCancel: false
      }))
    });

    expect(view?.questions[0]?.allowCancel).toBe(false);
  });

  test("formats multi-question replies for the runtime", () => {
    expect(
      buildUserQuestionReplyMessage({
        payload: {
          questions: [
            {
              questionText: "覆盖 CLI？",
              options: [],
              allowCancel: true
            },
            {
              questionText: "覆盖 Web？",
              options: [],
              allowCancel: true
            }
          ],
          createdAt: "2026-04-26T09:00:00.000Z"
        },
        replies: ["先做 CLI", "Web 只补 UI"]
      })
    ).toBe(
      "问题 1：覆盖 CLI？\n回答：先做 CLI\n\n问题 2：覆盖 Web？\n回答：Web 只补 UI"
    );
  });
});

describe("confirmation card", () => {
  test("builds a conflict confirmation card from the pending payload", () => {
    const view = buildConfirmationCardView(pendingConfirmationPayload);

    expect(view?.key).toBe(getConfirmationKey(pendingConfirmationPayload));
    expect(view?.summaryText).toBe("请确认是否覆盖原有日程");
    expect(view?.proposedItems).toHaveLength(1);
    expect(view?.conflictItems).toHaveLength(1);
    expect(view?.contextNote).toBe("确认后会先删除冲突项，再创建新的安排。");
  });

  test("returns null when there is no pending confirmation", () => {
    expect(buildConfirmationCardView(null)).toBeNull();
    expect(getConfirmationKey(null)).toBeNull();
  });
});
