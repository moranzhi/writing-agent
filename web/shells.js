/**
 * 呈现壳预览页：切换壳 / 装饰语气 / 正文长度，用示例数据渲染 present-shells。
 * 正文设计目标：单轮常见 600~3000 字 —— 随字数撑高，外层滚动；侧栏/选项坞钉住。
 */
import {
  PRESENT_SHELL_IDS,
  renderPresentShellHtml,
} from "./present-shells.js";

const SHELL_INFO = {
  prose: {
    name: "纯散文",
    blurb: "整块都是正文，无 HUD。长文直接往下滚。",
    density: "正文随字数伸展；无侧栏争面积",
    scenes: "轻对话、纯叙事、不要状态栏",
  },
  chat_monitor: {
    name: "对话 + 监控",
    blurb: "顶栏芯片固定矮；主聊/场面再长也只往下长。",
    density: "监控一行；正文撑高滚动",
    scenes: "网恋 / 日常扮演 / 轻 AIRP",
  },
  spotlight: {
    name: "场面主视",
    blurb: "芯片一行 + 大正文柱。适合一幕写满。",
    density: "正文主导并伸展；监控不占高",
    scenes: "电影感 RP、一幕一景、少机制",
  },
  turn_panel: {
    name: "回合面板",
    blurb: "场面叙述再长，右侧交互物钉在视口内对照。",
    density: "正文撑高；侧栏 sticky；行动在下",
    scenes: "资源、检定、场景交互、跑团感",
  },
  split_board: {
    name: "双栏看板",
    blurb: "左栏长文滚动，右栏线索钉住——对照读。",
    density: "左正文伸展；右侧栏 sticky",
    scenes: "调查、推理、多线索并行",
  },
  choice_dock: {
    name: "选择坞",
    blurb: "先读完长局面；选项坞 sticky 贴视口底，不用翻回顶。",
    density: "正文撑高；底部坞钉住",
    scenes: "选项驱动、AVG、分支关口",
  },
  chapter_reader: {
    name: "章节阅读",
    blurb: "章题 + 长阅读柱；窄进度侧栏 sticky。",
    density: "正文伸展为主；侧栏窄且钉住",
    scenes: "长文 / 爽文 / 先纲后章",
  },
};

const TONES = [
  { id: "default", label: "默认" },
  { id: "messenger", label: "讯息感" },
  { id: "book", label: "书页感" },
  { id: "terminal", label: "终端感" },
];

const LENGTHS = [
  { id: "short", label: "短（~120）" },
  { id: "mid", label: "中（~800）" },
  { id: "long", label: "长（~2500）" },
];

/** 中等长度 ≈800 字 */
const BODY_MID = `雨还在下。你把伞往她那边偏了偏，她没说话，只是把购物袋往怀里收紧了一点。水从伞骨边缘连成线，砸在柏油路上，溅起细碎的白点。

路口的灯跳成绿色。你们一起迈步——这一次，谁也没有先松开。对面便利店的玻璃上映着两个人并肩的轮廓，忽明忽暗，像谁随手画的草稿。

「伞……」她终于开口，声音被雨声压得很低，「明天不用还。」

你点头，又觉得这回答太轻，补了一句：「那我请你喝热的？」她侧过脸，雨丝粘在睫毛上，笑意只闪了一下，像怕被看穿。

电梯门开的时候，楼道里干燥得过分。她把袋子换到另一只手，钥匙在指间转了一圈，忽然停住：「其实我今天本来想绕路的。」

「为什么？」

「因为预报说会停。结果没有。」她把钥匙推进锁孔，「所以——只好借你的伞了。」

门开了一条缝。暖光漏出来，照在你们脚边的水渍上。她没有立刻进去，只是抬眼看你，像在等一句还没说出口的话。你把伞收拢，水仍顺着伞尖滴到地毯边缘。谁也没有提「进来坐坐」，但空气里已经有了那句话的形状。`;

/** 长文 ≈2500 字（重复段落拼成，预览用） */
const BODY_LONG = `${BODY_MID}

天桥下的风从另一头灌过来，把塑料袋吹得啪啪响。你想起上一次走过这里，还是夏天，蝉声吵得人没法好好说话；如今只剩雨，以及偶尔驶过的车灯，把积水切成一条条亮痕。

便利店里的收音机断断续续播着交通路况。店员打着哈欠换班，玻璃门开合时带进一阵湿冷。你站在门口抖伞，余光看见货架尽头有人停了很久——拿起一瓶水，又放下，再拿起，像在跟自己商量一件比购物更大的事。

她的短信迟了三分钟才到：「到家了吗？」你盯着屏幕上的光标，打了又删：刚进小区 / 伞还在我这 / 明天……最后只留下一句：「刚到。伞明天给你。」她回了个省略号，又补：「不用那么快。」

你把手机塞回口袋，忽然觉得「不用那么快」四个字比天气预报更准。有些东西一旦说破就会散，只好让它停在半湿半干之间。

楼道灯感应得慢，你摸黑上了两级台阶才亮。隔壁门缝里漏出电视剧的笑声，被雨声削成模糊的边。你靠着墙站了一会儿，听自己的呼吸从急变匀，才继续往上走。

到家后你把伞撑在阳台，水沿着伞骨汇成细流，滴进盆里，一声一声，像在数今晚还剩多少没说清的话。窗玻璃上凝着雾，你用指尖随便划了一道，很快又糊住——外面的城市灯火依旧，只是被雨帘隔成另一层世界。

你泡了杯热水，坐到桌前，本想写点什么，笔尖却停在空白处。纸页吸走一点水汽，皱起细纹。你写下一句又涂掉：关于伞，关于绿灯，关于她说「绕路」时那种几乎听不见的停顿。最后只留下日期，和一行没写完的「明天」。

夜里雨势小了些。你关灯前又看了一眼阳台——伞还在，水还在滴，只是间隔更长了，像什么人放慢了脚步，却没有真的离开。

（——以下为加长段，模拟单轮 2000+ 字场面——）

次日清晨，天边只剩薄云。你带着伞出门，金属骨架在布套里轻轻碰撞。电梯里遇见邻居遛狗，它的爪子在地垫上留下两串湿印，很快被后来的人踩散。你想：痕迹就是这样，被人看见时已不是原样。

到了约定的路口，她比你早到半分钟，手里多了一杯热饮，杯套上印着歪歪扭扭的笑脸。「还给你。」你把伞递过去。她却摇头：「今天晴。」伞停在两人之间，像一句还没决定归属的句子。

你们沿着河堤走。水面上漂着昨夜的落叶，偶有涟漪被风抹平。她讲起最近在忙的展览，讲到一半又停住，说其实不太想聊工作。于是话题滑向更碎的东西：哪家面馆换了老板、哪条巷子的灯坏了三天、哪一次下雨你们刚好都没带伞。

「所以才需要借。」她说。

「借完还要还。」你说。

「有的不用还。」她看着河对岸的塔吊，「有的还了，反而像没发生过。」

塔吊缓缓旋转，吊臂在灰蓝天空里划出钝角。你忽然明白，呈现壳要解决的不是「字大一点」，而是这一长段话落在界面里时，读者还愿不愿意往下看——状态栏不能抢戏，选项不能在中途消失，侧栏得钉住好让人对照线索。

你们在桥上站了一会儿。风把伞套吹得鼓起，又瘪下去。她把热饮塞进你手里：「暖的。你昨晚肯定没睡好。」你没有否认。杯壁的温度从掌心爬上手腕，像把雨夜重新烘了一遍，只留下能说出口的那一层。

分开前，她抬手点了点伞：「这个，先放你那儿。等下一场雨。」

你点头。伞重新沉进包里，重量不大，却让背包的一侧微微倾斜——刚好提醒你：故事还会继续，而界面必须装得下继续。`;

const BODY_SHORT = {
  prose:
    "雨还在下。你把伞往她那边偏了偏，她没说话，只是把购物袋往怀里收紧了一点。\n\n路口的灯跳成绿色。你们一起迈步——这一次，谁也没有先松开。",
  chat_monitor:
    "【短信】\n她：到家了吗？\n你：刚进小区。伞借你的，明天还给你？\n她：……不用那么快。",
  spotlight:
    "水从铁栏杆上砸下来，把对面那人的轮廓冲得忽明忽暗。\n\n他抬起头——认出是你的瞬间，肩膀松了一下，又立刻绷紧。",
  turn_panel:
    "货架后传来塑料袋摩擦声。你屏住呼吸，左手按住刀柄——也许只是风。\n\n收银台抽屉半开，里面有未拆封的电池。",
  split_board:
    "抽屉夹层里有一张折痕发白的收据。日期是失踪前夜，商户栏写着「北港五金」。\n\n窗台积灰被抹过一道——有人近来开过窗。",
  choice_dock:
    "她把钥匙放在桌上，没有推过来，也没有收回。\n\n「你要是现在走，我就当今晚什么都没发生。」",
  chapter_reader:
    "　　天亮得比往日晚。林晚站在窗边，把画册合上，指尖在封面上停了一息。\n\n　　「今天，」她说，「我们换条路回家。」",
};

const SAMPLE_META = {
  prose: {
    blocks: { footer: "本段为示例备注（可关）" },
    meta: { suggested_actions: [] },
  },
  chat_monitor: {
    blocks: {
      monitor: { 好感: "暖络", 今日话题: "下雨天", 体力: "还好" },
      footer: "",
    },
    meta: { suggested_actions: ["回一句关心", "约周末还伞"] },
  },
  spotlight: {
    blocks: {
      monitor: { 地点: "天桥下", 天气: "暴雨", 张力: "紧" },
      footer: "",
    },
    meta: { suggested_actions: ["先开口", "递伞过去"] },
  },
  turn_panel: {
    blocks: {
      monitor: { 体力: "6/10", 物资: "压缩饼干×2", 威胁: "低" },
      header: "第 12 回合 · 废弃便利店",
      footer: "检定：潜行（通过）",
      aside: { 可交互: "电池 / 后门 / 死角", 噪音: "低" },
    },
    meta: { suggested_actions: ["摸电池", "从后门离开", "大声喝问"] },
  },
  split_board: {
    blocks: {
      header: "案发现场 · 二楼书房",
      aside: {
        线索: "北港收据",
        证物: "窗台指痕",
        待查: "五金店监控",
      },
      footer: "",
    },
    meta: { suggested_actions: ["去北港", "采指纹", "先问管家"] },
  },
  choice_dock: {
    blocks: {
      monitor: { 信任: "中", 时间: "子夜前" },
      footer: "",
    },
    meta: {
      suggested_actions: ["拿走钥匙留下", "把钥匙推回去", "什么也不说，坐着"],
    },
  },
  chapter_reader: {
    blocks: {
      header: "卷三 · 第 7 章　雨停之前",
      aside: "进度：卷三 7/18\n下一钩：母亲来电",
      footer: "",
    },
    meta: { suggested_actions: [] },
  },
};

function pickBody(shell, length) {
  if (length === "short") return BODY_SHORT[shell] || BODY_SHORT.prose;
  if (length === "mid") return BODY_MID;
  return BODY_LONG;
}

function countChars(s) {
  return Array.from(String(s ?? "").replace(/\s/g, "")).length;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const state = {
  shell: "spotlight",
  tone: "default",
  length: "mid",
  showActions: true,
  blockLabels: {},
};

function buildTweaks() {
  return {
    tone_chrome: state.tone,
    show_suggested_actions: state.showActions,
    block_labels: { ...state.blockLabels },
    empty_states: {
      aside: "（侧栏空：可在创作里改空态文案）",
      footer: "（文末空）",
    },
  };
}

function buildPacket() {
  const base = SAMPLE_META[state.shell] || SAMPLE_META.prose;
  const body = pickBody(state.shell, state.length);
  return {
    schema: "present.v1",
    shell: state.shell,
    blocks: { ...base.blocks, body },
    meta: base.meta,
    _chars: countChars(body),
  };
}

function render() {
  const info = SHELL_INFO[state.shell] || {
    name: state.shell,
    blurb: "",
    scenes: "",
    density: "",
  };
  const packet = buildPacket();
  document.getElementById("panel-title").textContent = info.name;
  document.getElementById("panel-subtitle").textContent = `${info.scenes} · 正文约 ${packet._chars} 字（不计空白）`;

  document.getElementById("shell-meta").innerHTML = `
    <p><strong>${esc(info.name)}</strong>（<code>${esc(state.shell)}</code>）</p>
    <p>${esc(info.blurb)}</p>
    <p class="shells-density"><span>长文策略</span>${esc(info.density)} · 当前试读 <strong>${packet._chars}</strong> 字</p>
    <p class="muted">适用：${esc(info.scenes)}。请用上方「正文长度」切到长文，确认侧栏/选项是否仍可用。</p>
  `;

  const preview = document.getElementById("shell-preview");
  preview.dataset.shell = state.shell;
  preview.innerHTML = renderPresentShellHtml(packet, esc, { tweaks: buildTweaks() });

  document.querySelectorAll("[data-shell]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-shell") === state.shell);
  });
  document.querySelectorAll("[data-tone]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tone") === state.tone);
  });
  document.querySelectorAll("[data-length]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-length") === state.length);
  });

  const showActionsEl = document.getElementById("tweak-show-actions");
  if (showActionsEl) showActionsEl.checked = state.showActions;
}

function mount() {
  const list = document.getElementById("shell-list");
  list.innerHTML = PRESENT_SHELL_IDS.map((id) => {
    const info = SHELL_INFO[id];
    return `<button type="button" class="st-rail-item" data-shell="${esc(id)}" role="tab">
      ${esc(info?.name || id)}
    </button>`;
  }).join("");

  document.getElementById("tone-list").innerHTML = TONES.map(
    (t) =>
      `<button type="button" class="shells-tone-chip" data-tone="${esc(t.id)}">${esc(t.label)}</button>`,
  ).join("");

  document.getElementById("length-list").innerHTML = LENGTHS.map(
    (t) =>
      `<button type="button" class="shells-tone-chip" data-length="${esc(t.id)}">${esc(t.label)}</button>`,
  ).join("");

  document.getElementById("tweak-controls").innerHTML = `
    <label class="field">
      <input type="checkbox" id="tweak-show-actions" />
      显示「建议行动」（对应微调轴 show_suggested_actions）
    </label>
    <label class="field">
      正文区显示名（block_labels.body）
      <input type="text" id="tweak-label-body" placeholder="例如：短信记录 / 场面 / 本章" />
    </label>
    <label class="field">
      监控区显示名（block_labels.monitor）
      <input type="text" id="tweak-label-monitor" placeholder="例如：状态 / 今日" />
    </label>
  `;

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-shell]");
    if (!btn) return;
    state.shell = btn.getAttribute("data-shell");
    render();
  });

  document.getElementById("tone-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tone]");
    if (!btn) return;
    state.tone = btn.getAttribute("data-tone");
    render();
  });

  document.getElementById("length-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-length]");
    if (!btn) return;
    state.length = btn.getAttribute("data-length");
    render();
  });

  const syncLabels = () => {
    state.showActions = document.getElementById("tweak-show-actions").checked;
    const body = document.getElementById("tweak-label-body").value.trim();
    const monitor = document.getElementById("tweak-label-monitor").value.trim();
    state.blockLabels = {};
    if (body) state.blockLabels.body = body;
    if (monitor) state.blockLabels.monitor = monitor;
    render();
  };
  document.getElementById("tweak-controls").addEventListener("change", syncLabels);
  document.getElementById("tweak-controls").addEventListener("input", syncLabels);

  render();
}

mount();
