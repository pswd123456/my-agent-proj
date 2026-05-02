import { describe, expect, test } from "bun:test";

import {
  createConfirmationToolResultData,
  createPendingConfirmationDelegateRequest,
  createPendingConfirmationPayload,
  createPendingUserQuestionDelegateRequest,
  createPendingUserQuestionPayload,
  createUserQuestionToolResultData,
  PENDING_USER_QUESTION_CONTEXT_OPTION_LABEL
} from "../src/session-context";

describe("session context mappers", () => {
  test("round-trips user question tool input through pending payload and delegate request", () => {
    const questions = [
      {
        question_text: "先做 CLI 还是 Web？",
        options: [
          {
            label: "先做 CLI",
            reply: "先做 CLI",
            description: "先收敛 runtime 入口",
            is_recommended: true
          }
        ],
        context_note: "范围会影响测试入口。"
      },
      {
        question_text: "是否允许取消？",
        options: [
          {
            label: "继续",
            reply: "继续执行"
          }
        ],
        allow_cancel: false
      }
    ];

    const payload = createPendingUserQuestionPayload({
      questions,
      createdAt: "2026-05-02T00:00:00.000Z"
    });

    expect(payload).toEqual({
      questions: [
        {
          questionText: "先做 CLI 还是 Web？",
          options: [
            {
              label: "先做 CLI",
              reply: "先做 CLI",
              description: "先收敛 runtime 入口",
              isRecommended: true
            },
            {
              label: PENDING_USER_QUESTION_CONTEXT_OPTION_LABEL,
              reply: "范围会影响测试入口。",
              description: "范围会影响测试入口。"
            }
          ],
          allowCancel: true
        },
        {
          questionText: "是否允许取消？",
          options: [
            {
              label: "继续",
              reply: "继续执行"
            }
          ],
          allowCancel: false
        }
      ],
      createdAt: "2026-05-02T00:00:00.000Z"
    });

    expect(createUserQuestionToolResultData(questions)).toEqual({
      questions: [
        {
          question_text: "先做 CLI 还是 Web？",
          options: [
            {
              label: "先做 CLI",
              reply: "先做 CLI",
              description: "先收敛 runtime 入口",
              is_recommended: true
            }
          ],
          allow_cancel: true,
          context_note: "范围会影响测试入口。"
        },
        {
          question_text: "是否允许取消？",
          options: [
            {
              label: "继续",
              reply: "继续执行"
            }
          ],
          allow_cancel: false,
          context_note: null
        }
      ]
    });

    expect(createPendingUserQuestionDelegateRequest(payload)).toEqual({
      kind: "user_question",
      summary: "需要补充回答 2 个问题",
      data: {
        questions: [
          {
            questionText: "先做 CLI 还是 Web？",
            options: [
              {
                label: "先做 CLI",
                reply: "先做 CLI",
                description: "先收敛 runtime 入口",
                isRecommended: true
              },
              {
                label: PENDING_USER_QUESTION_CONTEXT_OPTION_LABEL,
                reply: "范围会影响测试入口。",
                description: "范围会影响测试入口。"
              }
            ],
            allowCancel: true
          },
          {
            questionText: "是否允许取消？",
            options: [
              {
                label: "继续",
                reply: "继续执行"
              }
            ],
            allowCancel: false
          }
        ]
      }
    });
  });

  test("round-trips confirmation tool input through pending payload and delegate request", () => {
    const payload = createPendingConfirmationPayload(
      {
        summary_text: "需要确认覆盖日程",
        proposed_items: [
          {
            preview_text: "创建 10:00 复习",
            tool_name: "create_routine",
            tool_input: {
              date: "2026-05-02",
              start_time: "10:00",
              duration_minutes: 45
            }
          }
        ],
        context_note: "已有冲突，需要用户取舍。",
        conflict_items: [
          {
            routine_id: "routine-1",
            preview_text: "10:15 旧任务"
          }
        ]
      },
      "2026-05-02T00:00:00.000Z"
    );

    expect(payload).toEqual({
      summaryText: "需要确认覆盖日程",
      proposedItems: [
        {
          previewText: "创建 10:00 复习",
          toolName: "create_routine",
          toolInput: {
            date: "2026-05-02",
            start_time: "10:00",
            duration_minutes: 45
          }
        }
      ],
      contextNote: "已有冲突，需要用户取舍。",
      conflictItems: [
        {
          routineId: "routine-1",
          previewText: "10:15 旧任务"
        }
      ],
      createdAt: "2026-05-02T00:00:00.000Z"
    });

    expect(createConfirmationToolResultData(payload)).toEqual({
      summary_text: "需要确认覆盖日程",
      proposed_items: [
        {
          preview_text: "创建 10:00 复习",
          tool_name: "create_routine",
          tool_input: {
            date: "2026-05-02",
            start_time: "10:00",
            duration_minutes: 45
          }
        }
      ],
      conflict_items: [
        {
          routine_id: "routine-1",
          preview_text: "10:15 旧任务"
        }
      ],
      context_note: "已有冲突，需要用户取舍。"
    });

    expect(createPendingConfirmationDelegateRequest(payload)).toEqual({
      kind: "confirmation_request",
      summary: "需要确认覆盖日程",
      data: {
        summaryText: "需要确认覆盖日程",
        proposedItems: [
          {
            previewText: "创建 10:00 复习",
            toolName: "create_routine",
            toolInput: {
              date: "2026-05-02",
              start_time: "10:00",
              duration_minutes: 45
            }
          }
        ],
        conflictItems: [
          {
            routineId: "routine-1",
            previewText: "10:15 旧任务"
          }
        ],
        contextNote: "已有冲突，需要用户取舍。"
      }
    });
  });
});
