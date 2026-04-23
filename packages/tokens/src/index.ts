export const foundation = {
  color: {
    ink: {
      50: "#f7f5ef",
      100: "#ebe6da",
      200: "#d8cfbd",
      300: "#bcac95",
      400: "#9a8469",
      500: "#7c674f",
      600: "#63503d",
      700: "#4b3c2e",
      800: "#33281f",
      900: "#1b1511",
      950: "#0f0b08"
    },
    sand: {
      50: "#fdfbf5",
      100: "#f6efdf",
      200: "#ebdfc1",
      300: "#dcc89d",
      400: "#c6ac74",
      500: "#ab8853",
      600: "#886741",
      700: "#684d33",
      800: "#483523",
      900: "#2d2017",
      950: "#19110c"
    },
    jade: {
      50: "#eefcf7",
      100: "#cff7e9",
      200: "#a1edd5",
      300: "#69ddbd",
      400: "#31c6a0",
      500: "#159f80",
      600: "#0f7e66",
      700: "#106350",
      800: "#124d40",
      900: "#123b31",
      950: "#071f1a"
    },
    amber: {
      50: "#fff8eb",
      100: "#fdeec8",
      200: "#f9db8a",
      300: "#f2bf49",
      400: "#e89d25",
      500: "#c97b18",
      600: "#a15d15",
      700: "#7d4615",
      800: "#603613",
      900: "#47280f",
      950: "#271606"
    },
    berry: {
      50: "#fff1f6",
      100: "#ffdce8",
      200: "#ffb7d0",
      300: "#ff7fac",
      400: "#f54c82",
      500: "#dd245f",
      600: "#b51649",
      700: "#8e133c",
      800: "#6e1434",
      900: "#4f1227",
      950: "#2c0815"
    }
  },
  typography: {
    fontFamily: {
      sans: '"Avenir Next", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
      mono: '"IBM Plex Mono", "SFMono-Regular", "SF Mono", "Cascadia Code", monospace'
    },
    fontSize: {
      12: "0.75rem",
      14: "0.875rem",
      16: "1rem",
      18: "1.125rem",
      20: "1.25rem",
      24: "1.5rem",
      32: "2rem",
      40: "2.5rem",
      56: "3.5rem"
    },
    lineHeight: {
      tight: "1.1",
      snug: "1.25",
      normal: "1.5",
      relaxed: "1.7"
    },
    fontWeight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700
    },
    letterSpacing: {
      tight: "-0.04em",
      normal: "0",
      wide: "0.18em"
    }
  },
  space: {
    2: "0.5rem",
    4: "1rem",
    6: "1.5rem",
    8: "2rem",
    10: "2.5rem",
    12: "3rem",
    16: "4rem",
    20: "5rem",
    24: "6rem"
  },
  radius: {
    sm: "0.5rem",
    md: "0.875rem",
    lg: "1.25rem",
    xl: "1.75rem",
    pill: "999px"
  },
  shadow: {
    sm: "0 12px 32px -20px rgba(15, 11, 8, 0.45)",
    md: "0 24px 70px -36px rgba(15, 11, 8, 0.55)",
    lg: "0 40px 100px -48px rgba(15, 11, 8, 0.68)"
  },
  border: {
    width: {
      thin: "1px",
      thick: "2px"
    },
    style: {
      solid: "solid"
    }
  },
  opacity: {
    disabled: "0.4",
    muted: "0.64",
    veil: "0.82"
  },
  motion: {
    duration: {
      fast: "160ms",
      moderate: "240ms",
      slow: "420ms"
    },
    easing: {
      standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      emphasized: "cubic-bezier(0.18, 1, 0.32, 1)"
    }
  },
  zIndex: {
    base: 0,
    docked: 10,
    sticky: 20,
    overlay: 40,
    modal: 50,
    toast: 60
  },
  breakpoint: {
    sm: "40rem",
    md: "48rem",
    lg: "64rem",
    xl: "80rem"
  }
} as const;

export const semantic = {
  color: {
    bg: {
      canvas: foundation.color.ink[950],
      surface: "rgba(32, 24, 18, 0.82)",
      elevated: "rgba(41, 31, 24, 0.94)",
      muted: "rgba(247, 245, 239, 0.06)",
      accent: foundation.color.jade[700]
    },
    text: {
      primary: foundation.color.sand[50],
      secondary: foundation.color.sand[100],
      muted: foundation.color.ink[300],
      accent: foundation.color.jade[200],
      inverse: foundation.color.ink[900]
    },
    border: {
      subtle: "rgba(246, 239, 223, 0.1)",
      strong: "rgba(246, 239, 223, 0.2)",
      accent: "rgba(105, 221, 189, 0.38)"
    },
    status: {
      success: foundation.color.jade[400],
      warning: foundation.color.amber[300],
      danger: foundation.color.berry[300]
    }
  },
  typography: {
    eyebrow: {
      fontFamily: foundation.typography.fontFamily.mono,
      fontSize: foundation.typography.fontSize[12],
      fontWeight: foundation.typography.fontWeight.medium,
      lineHeight: foundation.typography.lineHeight.normal,
      letterSpacing: foundation.typography.letterSpacing.wide
    },
    title: {
      fontFamily: foundation.typography.fontFamily.sans,
      fontSize: foundation.typography.fontSize[56],
      fontWeight: foundation.typography.fontWeight.semibold,
      lineHeight: foundation.typography.lineHeight.tight,
      letterSpacing: foundation.typography.letterSpacing.tight
    },
    body: {
      fontFamily: foundation.typography.fontFamily.sans,
      fontSize: foundation.typography.fontSize[18],
      fontWeight: foundation.typography.fontWeight.regular,
      lineHeight: foundation.typography.lineHeight.relaxed,
      letterSpacing: foundation.typography.letterSpacing.normal
    },
    caption: {
      fontFamily: foundation.typography.fontFamily.mono,
      fontSize: foundation.typography.fontSize[12],
      fontWeight: foundation.typography.fontWeight.medium,
      lineHeight: foundation.typography.lineHeight.normal,
      letterSpacing: foundation.typography.letterSpacing.wide
    }
  },
  surface: {
    panel: {
      background: "rgba(32, 24, 18, 0.82)",
      borderColor: "rgba(246, 239, 223, 0.1)",
      shadow: foundation.shadow.md
    },
    card: {
      background: "rgba(41, 31, 24, 0.94)",
      borderColor: "rgba(246, 239, 223, 0.14)",
      shadow: foundation.shadow.sm
    }
  }
} as const;

export const tokens = {
  foundation,
  semantic
} as const;

export interface TokenItem {
  name: string;
  value: string | number;
  usage: string;
}

export interface TokenSection {
  id: string;
  layer: "foundation" | "semantic";
  title: string;
  category: string;
  description: string;
  presentation: "color" | "typography" | "space" | "shadow" | "value";
  tokens: readonly TokenItem[];
}

export const tokenSections: readonly TokenSection[] = [
  {
    id: "foundation-color",
    layer: "foundation",
    title: "Foundation Color",
    category: "color",
    description: "基础色板的原始取值。",
    presentation: "color",
    tokens: [
      {
        name: "color.ink.950",
        value: foundation.color.ink[950],
        usage: "最深的画布与沉浸式背景"
      },
      {
        name: "color.ink.800",
        value: foundation.color.ink[800],
        usage: "深色容器与高对比模块"
      },
      {
        name: "color.ink.300",
        value: foundation.color.ink[300],
        usage: "深色主题里的弱对比文案"
      },
      {
        name: "color.sand.50",
        value: foundation.color.sand[50],
        usage: "浅色文本与高亮衬底"
      },
      {
        name: "color.sand.300",
        value: foundation.color.sand[300],
        usage: "中性色描边与分割层"
      },
      {
        name: "color.sand.500",
        value: foundation.color.sand[500],
        usage: "品牌温度与强调色过渡"
      },
      {
        name: "color.jade.400",
        value: foundation.color.jade[400],
        usage: "正向强调与可执行动作"
      },
      {
        name: "color.jade.700",
        value: foundation.color.jade[700],
        usage: "深色强调面与状态色基底"
      },
      {
        name: "color.amber.300",
        value: foundation.color.amber[300],
        usage: "提醒、告警与关注态"
      },
      {
        name: "color.berry.400",
        value: foundation.color.berry[400],
        usage: "风险提示与危险动作"
      }
    ]
  },
  {
    id: "foundation-typography",
    layer: "foundation",
    title: "Foundation Typography",
    category: "typography",
    description: "排版相关的字体、字号、行高和字距。",
    presentation: "typography",
    tokens: [
      {
        name: "typography.fontFamily.sans",
        value: foundation.typography.fontFamily.sans,
        usage: "界面正文与标题默认字体族"
      },
      {
        name: "typography.fontFamily.mono",
        value: foundation.typography.fontFamily.mono,
        usage: "token 名称、标签与技术信息"
      },
      {
        name: "typography.fontSize.18",
        value: foundation.typography.fontSize[18],
        usage: "正文与描述型段落"
      },
      {
        name: "typography.fontSize.56",
        value: foundation.typography.fontSize[56],
        usage: "页面级标题"
      },
      {
        name: "typography.lineHeight.relaxed",
        value: foundation.typography.lineHeight.relaxed,
        usage: "长段落与说明文字"
      },
      {
        name: "typography.letterSpacing.wide",
        value: foundation.typography.letterSpacing.wide,
        usage: "eyebrow、标签、弱装饰文本"
      }
    ]
  },
  {
    id: "foundation-space",
    layer: "foundation",
    title: "Foundation Space",
    category: "space",
    description: "用有限间距级差控制页面节奏，避免页面里散落任意尺寸。",
    presentation: "space",
    tokens: [
      {
        name: "space.2",
        value: foundation.space[2],
        usage: "微距标签与图标间距"
      },
      {
        name: "space.4",
        value: foundation.space[4],
        usage: "字段组默认内边距"
      },
      {
        name: "space.8",
        value: foundation.space[8],
        usage: "卡片与局部模块分隔"
      },
      {
        name: "space.12",
        value: foundation.space[12],
        usage: "内容区块之间的主要呼吸"
      },
      {
        name: "space.20",
        value: foundation.space[20],
        usage: "页面章节的垂直间隔"
      }
    ]
  },
  {
    id: "foundation-radius",
    layer: "foundation",
    title: "Foundation Radius",
    category: "radius",
    description:
      "圆角既决定情绪也影响层次感，应通过 token 管理而非页面临时指定。",
    presentation: "value",
    tokens: [
      {
        name: "radius.sm",
        value: foundation.radius.sm,
        usage: "输入框、标签和小型控件"
      },
      {
        name: "radius.md",
        value: foundation.radius.md,
        usage: "默认卡片与面板"
      },
      {
        name: "radius.xl",
        value: foundation.radius.xl,
        usage: "重点信息区和展示卡"
      },
      {
        name: "radius.pill",
        value: foundation.radius.pill,
        usage: "胶囊按钮与状态标签"
      }
    ]
  },
  {
    id: "foundation-shadow",
    layer: "foundation",
    title: "Foundation Shadow",
    category: "shadow",
    description: "阴影只保留少量层级，避免每个页面都发明自己的悬浮效果。",
    presentation: "shadow",
    tokens: [
      {
        name: "shadow.sm",
        value: foundation.shadow.sm,
        usage: "紧凑卡片和浮层提示"
      },
      {
        name: "shadow.md",
        value: foundation.shadow.md,
        usage: "主要面板和大块容器"
      },
      {
        name: "shadow.lg",
        value: foundation.shadow.lg,
        usage: "沉浸式 Hero 或高权重弹层"
      }
    ]
  },
  {
    id: "foundation-system",
    layer: "foundation",
    title: "Foundation System Values",
    category: "system",
    description: "这些 token 支撑边框、透明度、动效、层级和响应式断点。",
    presentation: "value",
    tokens: [
      {
        name: "border.width.thin",
        value: foundation.border.width.thin,
        usage: "默认描边与分割线"
      },
      {
        name: "opacity.muted",
        value: foundation.opacity.muted,
        usage: "弱化态内容与说明文本"
      },
      {
        name: "motion.duration.moderate",
        value: foundation.motion.duration.moderate,
        usage: "默认转场与 hover 动效"
      },
      {
        name: "motion.easing.standard",
        value: foundation.motion.easing.standard,
        usage: "大多数页面交互的缓动曲线"
      },
      {
        name: "zIndex.modal",
        value: foundation.zIndex.modal,
        usage: "模态层级"
      },
      {
        name: "breakpoint.lg",
        value: foundation.breakpoint.lg,
        usage: "大屏布局切换阈值"
      }
    ]
  },
  {
    id: "semantic-color",
    layer: "semantic",
    title: "Semantic Color",
    category: "color",
    description: "页面和组件优先消费语义色，不直接引用基础色板。",
    presentation: "color",
    tokens: [
      {
        name: "color.bg.canvas",
        value: semantic.color.bg.canvas,
        usage: "应用主画布背景"
      },
      {
        name: "color.bg.surface",
        value: semantic.color.bg.surface,
        usage: "标准容器与信息面板"
      },
      {
        name: "color.bg.elevated",
        value: semantic.color.bg.elevated,
        usage: "抬升层、重点卡片和局部高亮"
      },
      {
        name: "color.text.primary",
        value: semantic.color.text.primary,
        usage: "默认正文和标题"
      },
      {
        name: "color.text.muted",
        value: semantic.color.text.muted,
        usage: "说明、辅助标签和低优先级内容"
      },
      {
        name: "color.border.subtle",
        value: semantic.color.border.subtle,
        usage: "默认描边与分隔"
      },
      {
        name: "color.status.success",
        value: semantic.color.status.success,
        usage: "完成、在线、通过"
      },
      {
        name: "color.status.warning",
        value: semantic.color.status.warning,
        usage: "提醒、待处理、风险预警"
      },
      {
        name: "color.status.danger",
        value: semantic.color.status.danger,
        usage: "失败、删除、阻塞"
      }
    ]
  },
  {
    id: "semantic-typography",
    layer: "semantic",
    title: "Semantic Typography",
    category: "typography",
    description: "语义排版把基础排版 token 组合成可直接复用的角色。",
    presentation: "typography",
    tokens: [
      {
        name: "typography.eyebrow",
        value: `${semantic.typography.eyebrow.fontSize} / ${semantic.typography.eyebrow.letterSpacing}`,
        usage: "页面 eyebrow 与章节标签"
      },
      {
        name: "typography.title",
        value: `${semantic.typography.title.fontSize} / ${semantic.typography.title.lineHeight}`,
        usage: "页面主标题与 Hero 级信息"
      },
      {
        name: "typography.body",
        value: `${semantic.typography.body.fontSize} / ${semantic.typography.body.lineHeight}`,
        usage: "正文描述与解释性内容"
      },
      {
        name: "typography.caption",
        value: `${semantic.typography.caption.fontSize} / ${semantic.typography.caption.letterSpacing}`,
        usage: "辅助标签、注释和 token 元信息"
      }
    ]
  },
  {
    id: "semantic-surface",
    layer: "semantic",
    title: "Semantic Surface",
    category: "surface",
    description: "面板级 token 用来统一卡片、浮层和信息分区的材质感。",
    presentation: "shadow",
    tokens: [
      {
        name: "surface.panel.shadow",
        value: semantic.surface.panel.shadow,
        usage: "主容器、导航区和大块说明区"
      },
      {
        name: "surface.card.shadow",
        value: semantic.surface.card.shadow,
        usage: "内容卡、列表项和小型摘要块"
      }
    ]
  }
] as const;
