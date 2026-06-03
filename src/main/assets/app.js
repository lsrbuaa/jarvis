const STORAGE_KEY = 'jarvis.opc.state.v2';
const DEFAULT_AGENT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_AGENT_MODEL = 'doubao-seed-2-0-pro-260215';

const NAV = [
    { id: 'home', label: '今日', icon: 'home' },
    { id: 'schedule', label: '计划', icon: 'calendar' },
    { id: 'office', label: '工作', icon: 'monitor' },
    { id: 'nutrition', label: '健康', icon: 'heart' },
    { id: 'diary', label: '记忆', icon: 'brief' }
];

const SCHEDULE_FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'task', label: 'To-do' },
    { id: 'event', label: 'Calendar' },
    { id: 'focus', label: 'Task' },
    { id: 'health', label: '健康' }
];

const MEAL_SLOTS = [
    { id: 'breakfast', label: '早餐', target: 420 },
    { id: 'lunch', label: '午餐', target: 680 },
    { id: 'dinner', label: '晚餐', target: 720 },
    { id: 'other', label: '加餐', target: 220 }
];

const OFFICE_MODES = [
    { id: 'focus', label: '专注', icon: 'target', command: '开启专注计时 / 静音通知', description: '适合深度工作和代码、方案、材料撰写。' },
    { id: 'meeting', label: '会议', icon: 'video', command: '会议静音 / 记录行动项', description: '把手势映射到静音、确认、会议纪要和后续任务。' },
    { id: 'presentation', label: '演示', icon: 'presentation', command: '下一页 / 上一页 / 标记重点', description: '路演、评审和汇报时减少触屏操作。' },
    { id: 'writing', label: '文档', icon: 'file', command: '滚动文档 / 插入待办', description: '适合长文档阅读、资料整理和轻量编辑。' }
];

const MOODS = ['稳定', '开心', '疲惫', '焦虑', '低落', '专注'];
const PET_ASSETS = ['jarvis-companion-avatar.png'];
const LEGACY_PET_ASSETS = ['pet-happy.gif', 'pet-walk.gif', 'pet-sleep.gif', 'pet-shake-dizzy.gif'];

let state;
let ui = {
    tab: 'home',
    scheduleFilter: 'all',
    gestureActive: false,
    gestureStatus: '摄像头未启动',
    lastGestureAt: 0
};
let nativeCallbacks = {};
let gestureStream = null;
let gestureLoopId = 0;
let previousGestureFrame = null;

document.addEventListener('DOMContentLoaded', () => {
    state = loadState();
    bindShell();
    render();
    refreshSensorSnapshot();
    setInterval(refreshSensorSnapshot, 2200);
    if (window.JarvisAndroid && window.JarvisAndroid.startSensorStream) {
        window.JarvisAndroid.startSensorStream();
    }
});

window.__jarvisSensorUpdate = (payload) => {
    try {
        state.sensor = typeof payload === 'string' ? JSON.parse(payload) : payload;
        saveState();
        updateSensorUi();
    } catch (error) {
        console.warn(error);
    }
};

window.__jarvisNativeCallback = (callbackId, ok, payload) => {
    const callback = nativeCallbacks[callbackId];
    if (!callback) return;
    delete nativeCallbacks[callbackId];
    if (ok) {
        callback.resolve(payload);
    } else {
        callback.reject(new Error(readArkError(safeJsonParse(payload)) || '云端 Agent 调用失败'));
    }
};

function bindShell() {
    document.getElementById('menuButton').addEventListener('click', openSideMenu);
    document.getElementById('sensorButton').addEventListener('click', openSensorPanel);
    document.getElementById('composerButton').addEventListener('click', openChat);
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return migrateState(JSON.parse(raw));
    } catch (error) {
        console.warn(error);
    }
    return defaultState();
}

function migrateState(next) {
    const fresh = defaultState();
    return {
        ...fresh,
        ...next,
        settings: { ...fresh.settings, ...(next.settings || {}) },
        pet: normalizePetState({ ...fresh.pet, ...(next.pet || {}) }),
        sensor: { ...fresh.sensor, ...(next.sensor || {}) },
        habits: { ...fresh.habits, ...(next.habits || {}) },
        office: { ...fresh.office, ...(next.office || {}) },
        schedule: Array.isArray(next.schedule) ? next.schedule : fresh.schedule,
        diaries: Array.isArray(next.diaries) ? next.diaries : fresh.diaries,
        meals: Array.isArray(next.meals) ? next.meals : fresh.meals,
        commandLog: Array.isArray(next.commandLog) ? next.commandLog : fresh.commandLog,
        agentMessages: Array.isArray(next.agentMessages) ? next.agentMessages : fresh.agentMessages
    };
}

function normalizePetState(pet) {
    return {
        ...pet,
        image: normalizeBundledAssetPath(pet.image)
    };
}

function normalizeBundledAssetPath(path) {
    const value = String(path || '');
    if (!value || value.startsWith('data:') || value.startsWith('blob:')) return value;
    const normalized = value
        .replace(/^pet[\\/]/, '')
        .replace(/^visuals[\\/]/, '');
    return LEGACY_PET_ASSETS.includes(normalized) ? 'jarvis-companion-avatar.png' : normalized;
}

function defaultState() {
    const today = startOfDay(Date.now());
    return {
        version: 3,
        settings: {
            baseUrl: DEFAULT_AGENT_BASE_URL,
            apiKey: '',
            modelName: DEFAULT_AGENT_MODEL,
            cloudAgent: false
        },
        pet: {
            name: 'HXD-01',
            level: 3,
            bond: 72,
            mood: '专注陪跑',
            image: 'jarvis-companion-avatar.png',
            traits: ['陪伴', '提醒', '复盘'],
            generatedFromPhoto: false
        },
        sensor: {
            accelerometer: [0, 0, 0],
            gyroscope: [0, 0, 0],
            light: null,
            motion: 0,
            battery: -1,
            updatedAt: 0,
            running: false
        },
        habits: {
            water: 4,
            stand: 3,
            focusBlocks: 2,
            moodScore: 76
        },
        office: {
            mode: 'focus',
            focusMinutesToday: 90,
            lastBreakAt: Date.now() - 76 * 60000,
            quietMode: false,
            lastBriefAt: 0
        },
        schedule: [
            {
                id: uuid(),
                type: 'event',
                title: 'OPC 项目晨会',
                startsAt: setTime(today, 9, 30),
                durationMinutes: 30,
                pillar: 'work',
                notes: '同步 Jarvis 原型和演示分工',
                done: false,
                createdAt: Date.now()
            },
            {
                id: uuid(),
                type: 'focus',
                title: '深度工作：手势控制 demo',
                startsAt: setTime(today, 10, 30),
                durationMinutes: 90,
                pillar: 'work',
                notes: '摄像头识别、指令队列、桌面桥接',
                done: false,
                createdAt: Date.now()
            },
            {
                id: uuid(),
                type: 'health',
                title: '站立拉伸和补水',
                startsAt: setTime(today, 15, 0),
                durationMinutes: 10,
                pillar: 'life',
                notes: '久坐超过 90 分钟后提醒',
                done: false,
                createdAt: Date.now()
            }
        ],
        diaries: [
            {
                id: uuid(),
                mood: '专注',
                text: '今天把日程、伙伴、饮食和办公控制收敛到一个入口，减少切换成本。',
                image: '',
                createdAt: Date.now() - 3600000
            }
        ],
        meals: [
            {
                id: uuid(),
                slot: 'breakfast',
                title: '燕麦酸奶和咖啡',
                calories: 430,
                protein: 22,
                image: '',
                note: '碳水适中，适合上午专注块。',
                createdAt: setTime(today, 8, 20)
            }
        ],
        commandLog: [
            { id: uuid(), gesture: '张掌', command: '暂停输入', createdAt: Date.now() - 2400000, status: '已记录' }
        ],
        agentMessages: [
            {
                id: uuid(),
                role: 'assistant',
                text: '我是 Jarvis。你可以让我添加任务、规划日程、记录心情、分析一餐，或把手势转换成办公指令。',
                createdAt: Date.now()
            }
        ]
    };
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
    document.getElementById('bottomNav').innerHTML = NAV.map((item) => `
        <button class="nav-item ${ui.tab === item.id ? 'active' : ''}" onclick="switchTab('${item.id}')">
            <span class="nav-icon">${iconSvg(item.icon)}</span>
            <span>${item.label}</span>
        </button>
    `).join('');

    const content = document.getElementById('content');
    if (ui.tab === 'home') content.innerHTML = renderHome();
    if (ui.tab === 'schedule') content.innerHTML = renderSchedule();
    if (ui.tab === 'diary') content.innerHTML = renderDiary();
    if (ui.tab === 'nutrition') content.innerHTML = renderNutrition();
    if (ui.tab === 'office') content.innerHTML = renderOffice();
    updateSensorUi();
}

function switchTab(tab) {
    if (ui.tab === 'office' && tab !== 'office') stopGestureCamera();
    ui.tab = tab;
    render();
    window.scrollTo(0, 0);
}

function renderHome() {
    const scores = healthScores();
    const openItems = state.schedule
        .filter((item) => !item.done)
        .sort((a, b) => a.startsAt - b.startsAt)
        .slice(0, 3);
    const latestDiary = state.diaries.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
    return `
        <section class="page">
            <div class="screen-title">
                <div>
                    <p class="eyebrow">${formatLongDate(Date.now())}</p>
                    <h1>今日</h1>
                </div>
                <button class="avatar-chip" onclick="switchTab('diary')" aria-label="记忆">
                    <img src="${attr(state.pet.image)}" alt="HXD">
                    <span></span>
                </button>
            </div>

            <section class="visual-card command-visual">
                <img src="jarvis-command-center.png" alt="Jarvis 办公驾驶舱">
                <div class="visual-scrim"></div>
                <div class="visual-copy">
                    <span class="pill dark">办公驾驶舱</span>
                    <strong>行动、健康、记忆统一成今日视图</strong>
                </div>
            </section>

            <section class="control-strip">
                <span class="subtle">当前模式</span>
                <strong>${iconSvg(currentOfficeMode().icon)} ${currentOfficeMode().label}模式</strong>
                <button class="soft-btn" onclick="switchTab('office')">切换模式</button>
            </section>

            <section class="next-card">
                <div>
                    <span class="section-title">下一步</span>
                    <strong>${openItems[0] ? `${formatTime(openItems[0].startsAt)} 处理「${esc(openItems[0].title)}」` : '安排一个 45 分钟专注块'}</strong>
                    <p class="subtle">${nextNudge()}</p>
                </div>
                <button class="soft-btn" onclick="${openItems[0] ? `switchTab('schedule')` : 'startFocusSprint()'}">${openItems[0] ? '查看详情' : '开始'}</button>
            </section>

            <section class="workload-card">
                <div class="section-head"><span class="section-title">今日工作负载</span><span class="pill">${officeLoadText()}</span></div>
                <div class="stat-columns">
                    ${compactStat(state.schedule.filter((item) => !item.done).length, '待办任务', '项待处理')}
                    ${compactStat(state.schedule.filter((item) => item.type === 'event').length, '日程安排', '项日程')}
                    ${compactStat(`${(state.office.focusMinutesToday / 60).toFixed(1)}h`, '专注时长', '建议 3-4h')}
                </div>
            </section>

            <section class="workload-card">
                <div class="section-head"><span class="section-title">健康节奏</span><button class="link-btn" onclick="switchTab('nutrition')">详情</button></div>
                <div class="stat-columns">
                    ${compactStat(sittingRiskText(), '久坐风险', `${sittingMinutes()} 分钟`)}
                    ${compactStat(`${state.habits.water} / 4`, '补水进度', '杯')}
                    ${compactStat(`${state.habits.stand} / 6`, '站立次数', '次')}
                </div>
            </section>

            <section class="energy-card">
                <span class="tool-icon">${iconSvg('heart')}</span>
                <div>
                    <strong>能量 ${scores.mind} / 100</strong>
                    <p class="subtle">${latestDiary ? `最近心情：${latestDiary.mood}` : '还没有记录心情'}。${stressText()}</p>
                    <div class="progress"><span style="width:${clamp(scores.mind, 0, 100)}%"></span></div>
                </div>
            </section>

            <section class="section">
                <div class="section-head"><span class="section-title">快捷操作</span></div>
                <div class="action-grid">
                    ${quickActionButton('target', '专注', '45 分钟', 'startFocusSprint()')}
                    ${quickActionButton('cup', '补水', `第 ${state.habits.water + 1} 杯`, 'logWater()')}
                    ${quickActionButton('stretch', '站立', sittingRiskText(), 'logStandBreak()')}
                    ${quickActionButton('brief', '办公日报', '生成摘要', 'openDailyBrief()')}
                </div>
            </section>

            <section class="section">
                <div class="section-head">
                    <span class="section-title">今日时间线</span>
                    <button class="link-btn" onclick="openScheduleForm()">添加</button>
                </div>
                <div class="stack">
                    ${openItems.length ? openItems.map(scheduleRowHtml).join('') : emptyHtml('今天没有待处理项目', '让 Jarvis 帮你排一个专注块。')}
                </div>
            </section>

            <section class="insight-band">
                <div class="section-head">
                    <span class="section-title">Jarvis 记忆</span>
                    <button class="link-btn" onclick="openSensorPanel()">传感器</button>
                </div>
                <div class="score-list">
                    ${scoreRow('感知输入', sensorSummary(), sensorFreshness())}
                    ${scoreRow('办公态势', `${currentOfficeMode().label}模式 · ${officeLoadText()}`, 'OPC')}
                    ${scoreRow('工作记忆', `${state.schedule.length} 项日程，${state.diaries.length} 条日记`, '本地')}
                    ${scoreRow('慢思考', monthlyReviewText(), '复盘')}
                </div>
            </section>
        </section>
    `;
}

function renderSchedule() {
    const items = filteredSchedule().sort((a, b) => a.startsAt - b.startsAt);
    const doneCount = state.schedule.filter((item) => item.done).length;
    return `
        <section class="page">
            <div class="screen-title">
                <div>
                    <p class="eyebrow">Unified Timeline</p>
                    <h1>计划</h1>
                </div>
                <button class="icon-btn" onclick="openScheduleForm()" aria-label="添加">${iconSvg('plus')}</button>
            </div>
            <div class="chip-row">
                ${SCHEDULE_FILTERS.map((filter) => `
                    <button class="chip ${ui.scheduleFilter === filter.id ? 'active' : ''}" onclick="setScheduleFilter('${filter.id}')">${filter.label}</button>
                `).join('')}
            </div>
            <div class="grid-3">
                ${miniStat(state.schedule.length, '总项目')}
                ${miniStat(state.schedule.filter((item) => !item.done).length, '进行中')}
                ${miniStat(doneCount, '已完成')}
            </div>
            <section class="section">
                <div class="section-head">
                    <span class="section-title">今日时间线</span>
                    <button class="link-btn" onclick="completeFocusBlock()">完成专注</button>
                </div>
                <div class="stack">
                    ${items.length ? items.map(scheduleRowHtml).join('') : emptyHtml('没有匹配项目', '切换筛选或新增一条任务。')}
                </div>
            </section>
        </section>
    `;
}

function renderDiary() {
    const entries = state.diaries.slice().sort((a, b) => b.createdAt - a.createdAt);
    const latestDiary = entries[0];
    return `
        <section class="page">
            <div class="screen-title">
                <div>
                    <p class="eyebrow">Memory Layer</p>
                    <h1>记忆</h1>
                </div>
                <button class="icon-btn" onclick="openDiaryForm()" aria-label="写日记">${iconSvg('edit')}</button>
            </div>

            <section class="visual-card memory-visual">
                <img src="jarvis-health-memory.png" alt="Jarvis 健康与记忆复盘">
                <div class="visual-scrim"></div>
                <div class="visual-copy">
                    <span class="pill dark">长期记忆</span>
                    <strong>办公片段沉淀成复盘材料</strong>
                </div>
            </section>

            ${petDockHtml()}
            <input class="hidden-input" id="petPhotoInput" type="file" accept="image/*" capture="environment" onchange="handlePetPhoto(this.files)">

            <div class="grid-2">
                <button class="tool-card" onclick="openDiaryForm()">
                    <span class="tool-icon">${iconSvg('edit')}</span>
                    <span><strong>记录今日片段</strong><span class="subtle">情绪、画面和复盘一句话</span></span>
                </button>
                <button class="tool-card" onclick="openDailyBrief()">
                    <span class="tool-icon">${iconSvg('brief')}</span>
                    <span><strong>生成办公日报</strong><span class="subtle">完成项、健康和下一步</span></span>
                </button>
            </div>

            <section class="workload-card">
                <div class="section-head"><span class="section-title">记忆摘要</span><span class="pill">${monthlyReviewText()}</span></div>
                <div class="score-list">
                    ${scoreRow('最近情绪', latestDiary ? latestDiary.mood : '未记录', '心情')}
                    ${scoreRow('工作沉淀', `${state.schedule.filter((item) => item.done).length} 项已完成，${state.commandLog.length} 条指令`, '本地')}
                    ${scoreRow('HXD 状态', `${state.pet.name} · 亲密度 ${state.pet.bond}`, '陪伴')}
                </div>
            </section>

            <section class="section">
                <div class="section-head">
                    <span class="section-title">最近日记</span>
                </div>
                <div class="stack">
                    ${entries.length ? entries.map(diaryRowHtml).join('') : emptyHtml('还没有日记', '写一句也可以，Jarvis 会帮你沉淀复盘。')}
                </div>
            </section>
        </section>
    `;
}

function renderNutrition() {
    const todayMeals = mealsToday();
    const calories = todayMeals.reduce((sum, meal) => sum + Number(meal.calories || 0), 0);
    const protein = todayMeals.reduce((sum, meal) => sum + Number(meal.protein || 0), 0);
    return `
        <section class="page">
            <div class="screen-title">
                <div>
                    <p class="eyebrow">Health Rhythm</p>
                    <h1>健康</h1>
                </div>
                <button class="icon-btn" onclick="openMealForm()" aria-label="添加饮食">${iconSvg('plus')}</button>
            </div>

            <section class="visual-card health-visual">
                <img src="jarvis-health-memory.png" alt="Jarvis 健康节奏">
                <div class="visual-scrim"></div>
                <div class="visual-copy">
                    <span class="pill dark">健康节奏</span>
                    <strong>健康节奏回写今日建议</strong>
                </div>
            </section>

            <section class="workload-card">
                <div class="section-head"><span class="section-title">健康概览</span><span class="pill">${sittingRiskText()}</span></div>
                <div class="stat-columns">
                    ${compactStat(`${state.habits.water} / 4`, '补水', '今日目标')}
                    ${compactStat(`${state.habits.stand} / 6`, '站立', '每小时 1 次')}
                    ${compactStat(`${todayMeals.length} / 3`, '饮食', '均衡饮食')}
                    ${compactStat(state.habits.moodScore, '心情能量', '状态良好')}
                </div>
            </section>

            ${officeHealthPanel()}

            <section class="section">
                <div class="section-head">
                    <span class="section-title">饮食记录</span>
                    <button class="link-btn" onclick="openMealForm()">手动添加</button>
                </div>
                <div class="grid-2">
                    ${MEAL_SLOTS.map(mealSlotCard).join('')}
                </div>
            </section>

            <section class="insight-band">
                <div class="section-head">
                    <span class="section-title">健康复盘</span>
                </div>
                <div class="score-list">
                    ${scoreRow('热量趋势', calories ? `${calories} kcal，接近办公日目标` : '今天还没有饮食记录', '今日')}
                    ${scoreRow('蛋白质', `${protein} g`, '今日')}
                    ${scoreRow('结构建议', protein >= 60 ? '蛋白质充足，晚间注意清淡' : '蛋白质偏少，可补充蛋、奶、豆或鱼肉', '建议')}
                    ${scoreRow('30 天沉淀', monthlyReviewText(), '月报')}
                </div>
            </section>
        </section>
    `;
}

function renderOffice() {
    const commands = state.commandLog.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
    return `
        <section class="page">
            <div class="screen-title">
                <div>
                    <p class="eyebrow">Work Mode</p>
                    <h1>工作</h1>
                </div>
                <button class="icon-btn" onclick="${ui.gestureActive ? 'stopGestureCamera()' : 'startGestureCamera()'}" aria-label="摄像头">${iconSvg(ui.gestureActive ? 'pause' : 'camera')}</button>
            </div>

            ${officeModePanel()}

            <div class="camera-frame ${ui.gestureActive ? 'active' : 'idle'}">
                <video id="gestureVideo" muted playsinline></video>
                <canvas id="gestureCanvas" width="96" height="72" class="hidden-input"></canvas>
                <div class="camera-overlay">
                    <span class="pill">${ui.gestureActive ? '识别中' : '待启动'}</span>
                    <strong id="gestureStatus">${esc(ui.gestureStatus)}</strong>
                </div>
            </div>

            <div class="grid-2">
                <button class="tool-card" onclick="startGestureCamera()">
                    <span class="tool-icon">${iconSvg('camera')}</span>
                    <span><strong>开启摄像头</strong><span class="subtle">端侧运动差分识别原型</span></span>
                </button>
                <button class="tool-card" onclick="exportDesktopBridge()">
                    <span class="tool-icon">${iconSvg('monitor')}</span>
                    <span><strong>桌面桥接</strong><span class="subtle">导出电脑端指令队列</span></span>
                </button>
            </div>

            <section class="section">
                <div class="section-head">
                    <span class="section-title">手势快捷指令</span>
                </div>
                <div class="chip-row wrap">
                    <button class="chip" onclick="triggerGesture('挥手', '下一页 / 下一个标签')">挥手翻页</button>
                    <button class="chip" onclick="triggerGesture('张掌', '暂停输入 / 静音')">张掌暂停</button>
                    <button class="chip" onclick="triggerGesture('握拳', '确认 / 接听')">握拳确认</button>
                    <button class="chip" onclick="triggerGesture('双指', '滚动文档')">双指滚动</button>
                </div>
            </section>

            <section class="section">
                <div class="section-head">
                    <span class="section-title">指令队列</span>
                    <button class="link-btn" onclick="clearCommandLog()">清空</button>
                </div>
                <div class="command-log">
                    ${commands.length ? commands.map(commandItemHtml).join('') : emptyHtml('还没有办公指令', '启动摄像头或点击快捷手势生成一条。')}
                </div>
            </section>

            ${officeHealthPanel()}

            <section class="insight-band">
                <div class="section-head">
                    <span class="section-title">多传感器输入</span>
                    <button class="link-btn" onclick="openSensorPanel()">详情</button>
                </div>
                <div class="score-list">
                    ${scoreRow('运动强度', `<span id="sensorMotion">${esc(sensorMotionText())}</span>`, '加速度')}
                    ${scoreRow('环境光', `<span id="sensorLight">${esc(sensorLightText())}</span>`, '光照')}
                    ${scoreRow('电量', `<span id="sensorBattery">${esc(sensorBatteryText())}</span>`, '设备')}
                </div>
            </section>
        </section>
    `;
}

function todayOpsPanel(openItems, scores) {
    const next = openItems[0];
    return `
        <section class="ops-panel">
            <div class="section-head">
                <span class="section-title">今日办公助手</span>
                <button class="link-btn" onclick="openDailyBrief()">复盘</button>
            </div>
            <div class="ops-main">
                <div>
                    <strong>${currentOfficeMode().label}模式 · 工作健康 ${Math.round(scores.work)}</strong>
                    <p class="subtle">${next ? `下一项：${formatTime(next.startsAt)} ${next.title}` : '暂时没有待办，可以创建一个专注块。'}</p>
                </div>
                <span class="pill">${sittingRiskText()}</span>
            </div>
            <div class="action-grid">
                ${quickActionButton('target', '开始专注', '45 分钟冲刺', 'startFocusSprint()')}
                ${quickActionButton('cup', '补水', `${state.habits.water} 杯`, 'logWater()')}
                ${quickActionButton('stretch', '站立', `${sittingMinutes()} 分钟未休息`, 'logStandBreak()')}
                ${quickActionButton('brief', '日报', '生成摘要', 'openDailyBrief()')}
            </div>
        </section>
    `;
}

function officeModePanel() {
    const active = currentOfficeMode();
    return `
        <section class="mode-panel">
            <div class="section-head">
                <span class="section-title">OPC 工作模式</span>
                <span class="pill">${officeLoadText()}</span>
            </div>
            <div class="chip-row wrap">
                ${OFFICE_MODES.map((mode) => `
                    <button class="chip ${active.id === mode.id ? 'active' : ''}" onclick="setOfficeMode('${mode.id}')">${mode.label}</button>
                `).join('')}
            </div>
            <div class="mode-summary">
                <span class="tool-icon">${iconSvg(active.icon)}</span>
                <span>
                    <strong>${active.label}模式</strong>
                    <span class="subtle">${active.description}</span>
                    <span class="pill">${active.command}</span>
                </span>
            </div>
            <div class="action-grid">
                ${quickActionButton('target', '专注冲刺', '写入日程', 'startFocusSprint()')}
                ${quickActionButton('cup', '记录补水', '生活健康', 'logWater()')}
                ${quickActionButton('stretch', '拉伸站立', '久坐复位', 'logStandBreak()')}
                ${quickActionButton('brief', '生成复盘', '可复制日报', 'openDailyBrief()')}
            </div>
        </section>
    `;
}

function officeHealthPanel() {
    return `
        <section class="insight-band">
            <div class="section-head">
                <span class="section-title">工作健康监测</span>
                <button class="link-btn" onclick="logStandBreak()">已休息</button>
            </div>
            <div class="score-list">
                ${scoreRow('专注储备', `${state.office.focusMinutesToday} 分钟，${state.habits.focusBlocks} 个专注块`, '今日')}
                ${scoreRow('久坐风险', sittingRiskText(), `${sittingMinutes()}m`)}
                ${scoreRow('压力负荷', stressText(), officeLoadText())}
                ${scoreRow('环境状态', sensorLightText(), '光照')}
            </div>
        </section>
    `;
}

function quickActionButton(icon, title, detail, action) {
    return `
        <button class="quick-action" onclick="${action}">
            <span class="tool-icon">${iconSvg(icon)}</span>
            <span><strong>${esc(title)}</strong><span class="subtle">${esc(detail)}</span></span>
        </button>
    `;
}

function moduleTile(tab, icon, title, subtitle) {
    return `
        <button class="module-tile" onclick="switchTab('${tab}')">
            <span class="tile-icon">${iconSvg(icon)}</span>
            <strong>${esc(title)}</strong>
            <small>${esc(subtitle)}</small>
        </button>
    `;
}

function scoreMetric(type, value, label, detail) {
    return `
        <div class="metric ${type}">
            <strong>${Math.round(value)}</strong>
            <span>${esc(label)}</span>
            <small>${esc(detail)}</small>
        </div>
    `;
}

function metricHtml(value, label, unit) {
    return `
        <div class="metric">
            <strong>${esc(value)}</strong>
            <span>${esc(label)}</span>
            <small>${esc(unit)}</small>
        </div>
    `;
}

function miniStat(value, label) {
    return `<div class="card"><strong>${esc(value)}</strong><span class="subtle">${esc(label)}</span></div>`;
}

function compactStat(value, label, detail) {
    return `
        <div class="compact-stat">
            <strong>${esc(value)}</strong>
            <span>${esc(label)}</span>
            <small>${esc(detail)}</small>
        </div>
    `;
}

function petDockHtml() {
    const traits = state.pet.traits.map((trait) => `<span class="pill">${esc(trait)}</span>`).join('');
    return `
        <div class="card pet-dock">
            <div class="pet-avatar"><img src="${attr(state.pet.image)}" alt="HXD 电子伙伴"></div>
            <div>
                <strong>${esc(state.pet.name)} · Lv.${state.pet.level}</strong>
                <p class="subtle">状态：${esc(state.pet.mood)}。亲密度 ${state.pet.bond}/100。</p>
                <div class="progress"><span style="width:${clamp(state.pet.bond, 0, 100)}%"></span></div>
                <div class="chip-row wrap" style="margin-top:8px">${traits}</div>
            </div>
        </div>
    `;
}

function scheduleRowHtml(item) {
    const typeClass = item.type === 'event' ? 'event' : item.type === 'focus' ? 'focus' : item.type === 'health' ? 'health' : '';
    return `
        <button class="row" onclick="toggleScheduleDone('${item.id}')">
            <span class="check ${item.done ? 'checked' : ''}">${item.done ? iconSvg('check') : ''}</span>
            <span class="row-line ${typeClass}"></span>
            <span class="row-main">
                <strong class="${item.done ? 'done' : ''}">${esc(item.title)}</strong>
                <span class="subtle">${formatTime(item.startsAt)} · ${scheduleTypeLabel(item.type)} · ${pillarLabel(item.pillar)}</span>
            </span>
            <span class="pill">${item.durationMinutes}m</span>
        </button>
    `;
}

function diaryRowHtml(entry) {
    return `
        <div class="card">
            ${entry.image ? `<img class="pet-photo" src="${attr(entry.image)}" alt="日记照片">` : ''}
            <div class="section-head" style="margin-top:${entry.image ? '10px' : '0'}">
                <strong>${esc(entry.mood)}</strong>
                <span class="spacer"></span>
                <span class="pill">${formatShortDate(entry.createdAt)} ${formatTime(entry.createdAt)}</span>
            </div>
            <p class="subtle">${esc(entry.text)}</p>
        </div>
    `;
}

function mealSlotCard(slot) {
    const meal = mealsToday().find((item) => item.slot === slot.id);
    const inputId = `mealPhoto-${slot.id}`;
    return `
        <div class="card meal-card">
            <div class="meal-thumb">
                ${meal && meal.image ? `<img src="${attr(meal.image)}" alt="${esc(slot.label)}">` : iconSvg('meal')}
            </div>
            <div>
                <strong>${esc(slot.label)}</strong>
                <p class="subtle">${meal ? `${meal.title} · ${meal.calories} kcal` : `目标约 ${slot.target} kcal`}</p>
            </div>
            <input class="hidden-input" id="${inputId}" type="file" accept="image/*" capture="environment" onchange="handleMealPhoto('${slot.id}', this.files)">
            <button class="ghost-btn" onclick="document.getElementById('${inputId}').click()">${meal ? '重新拍照' : '拍照分析'}</button>
        </div>
    `;
}

function commandItemHtml(item) {
    return `
        <div class="command-item">
            <span class="pill">${esc(item.gesture)}</span>
            <strong>${esc(item.command)}</strong>
            <span class="subtle">${formatTime(item.createdAt)}</span>
        </div>
    `;
}

function scoreRow(label, value, badge) {
    return `
        <div class="score-row">
            <span class="subtle">${esc(label)}</span>
            <div>${value}</div>
            <span class="pill">${esc(badge)}</span>
        </div>
    `;
}

function emptyHtml(title, subtitle) {
    return `<div class="empty"><strong>${esc(title)}</strong><span class="subtle">${esc(subtitle)}</span></div>`;
}

function setScheduleFilter(filter) {
    ui.scheduleFilter = filter;
    render();
}

function filteredSchedule() {
    if (ui.scheduleFilter === 'all') return state.schedule;
    return state.schedule.filter((item) => item.type === ui.scheduleFilter);
}

function toggleScheduleDone(id) {
    const item = state.schedule.find((next) => next.id === id);
    if (!item) return;
    item.done = !item.done;
    if (item.type === 'focus' && item.done) {
        state.habits.focusBlocks += 1;
        state.pet.bond = clamp(state.pet.bond + 3, 0, 100);
    }
    saveState();
    render();
}

function completeFocusBlock() {
    const focus = state.schedule.find((item) => item.type === 'focus' && !item.done);
    if (focus) {
        focus.done = true;
    }
    state.habits.focusBlocks += 1;
    state.pet.bond = clamp(state.pet.bond + 2, 0, 100);
    saveState();
    render();
}

function openScheduleForm() {
    const defaultTime = inputDateTime(setTime(Date.now(), new Date().getHours() + 1, 0));
    openModal('添加日程', `
        <form id="scheduleForm" class="form-grid" onsubmit="submitSchedule(event)">
            <label class="field"><span>类型</span>
                <select name="type">
                    <option value="task">To-do</option>
                    <option value="event">Calendar</option>
                    <option value="focus">Task / 深度工作</option>
                    <option value="health">健康提醒</option>
                </select>
            </label>
            <label class="field"><span>标题</span><input name="title" required placeholder="例如：完成路演材料"></label>
            <label class="field"><span>开始时间</span><input name="startsAt" type="datetime-local" value="${defaultTime}"></label>
            <label class="field"><span>时长</span><input name="durationMinutes" type="number" min="5" step="5" value="30"></label>
            <label class="field"><span>健康维度</span>
                <select name="pillar">
                    <option value="work">工作健康</option>
                    <option value="life">生活健康</option>
                    <option value="mind">心理健康</option>
                </select>
            </label>
            <label class="field"><span>备注</span><textarea name="notes" placeholder="补充上下文，Jarvis 会用于复盘"></textarea></label>
        </form>
    `, modalActions('取消', '保存', 'scheduleForm'));
}

function submitSchedule(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const startsAt = Date.parse(form.get('startsAt')) || Date.now();
    state.schedule.push({
        id: uuid(),
        type: form.get('type'),
        title: String(form.get('title') || '').trim(),
        startsAt,
        durationMinutes: numberOr(form.get('durationMinutes'), 30),
        pillar: form.get('pillar'),
        notes: String(form.get('notes') || '').trim(),
        done: false,
        createdAt: Date.now()
    });
    saveState();
    closeModal();
    switchTab('schedule');
}

function openDiaryForm() {
    openModal('写一条图文日记', `
        <form id="diaryForm" class="form-grid" onsubmit="submitDiary(event)">
            <label class="field"><span>心情</span>
                <select name="mood">${MOODS.map((mood) => `<option value="${mood}">${mood}</option>`).join('')}</select>
            </label>
            <label class="field"><span>记录</span><textarea name="text" required placeholder="今天发生了什么？哪一刻需要被 Jarvis 记住？"></textarea></label>
            <label class="field"><span>照片</span><input name="photo" type="file" accept="image/*" capture="environment"></label>
        </form>
    `, modalActions('取消', '保存', 'diaryForm'));
}

async function submitDiary(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const file = form.get('photo');
    const image = file && file.size ? await fileToImageData(file) : '';
    state.diaries.push({
        id: uuid(),
        mood: form.get('mood'),
        text: String(form.get('text') || '').trim(),
        image,
        createdAt: Date.now()
    });
    state.habits.moodScore = moodToScore(form.get('mood'));
    state.pet.bond = clamp(state.pet.bond + 2, 0, 100);
    saveState();
    closeModal();
    switchTab('diary');
}

async function handlePetPhoto(files) {
    const file = files && files[0];
    if (!file) return;
    const image = await fileToImageData(file);
    const traitPool = ['陪伴', '复盘', '护眼', '补水', '提醒', '会议搭子', '情绪雷达'];
    const seed = Date.now();
    state.pet = {
        ...state.pet,
        name: `HXD-${String(seed).slice(-4)}`,
        level: state.pet.level + 1,
        bond: clamp(state.pet.bond + 8, 0, 100),
        mood: '刚从照片里醒来',
        image,
        traits: [traitPool[seed % traitPool.length], traitPool[(seed + 2) % traitPool.length], traitPool[(seed + 4) % traitPool.length]],
        generatedFromPhoto: true
    };
    state.diaries.push({
        id: uuid(),
        mood: '开心',
        text: `我把一张照片转化成了新的电子伙伴 ${state.pet.name}。`,
        image,
        createdAt: Date.now()
    });
    saveState();
    render();
    showToast('HXD 已生成');
}

function openMealForm(slot = 'lunch') {
    openModal('添加饮食记录', `
        <form id="mealForm" class="form-grid" onsubmit="submitMeal(event)">
            <label class="field"><span>餐次</span>
                <select name="slot">
                    ${MEAL_SLOTS.map((item) => `<option value="${item.id}" ${slot === item.id ? 'selected' : ''}>${item.label}</option>`).join('')}
                </select>
            </label>
            <label class="field"><span>名称</span><input name="title" required placeholder="例如：鸡胸肉沙拉"></label>
            <label class="field"><span>热量 kcal</span><input name="calories" type="number" min="0" value="520"></label>
            <label class="field"><span>蛋白质 g</span><input name="protein" type="number" min="0" value="28"></label>
            <label class="field"><span>照片</span><input name="photo" type="file" accept="image/*" capture="environment"></label>
            <label class="field"><span>备注</span><textarea name="note" placeholder="饱腹感、油盐、饭后状态"></textarea></label>
        </form>
    `, modalActions('取消', '保存', 'mealForm'));
}

async function submitMeal(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const file = form.get('photo');
    const image = file && file.size ? await fileToImageData(file) : '';
    upsertMeal({
        id: uuid(),
        slot: form.get('slot'),
        title: String(form.get('title') || '').trim(),
        calories: numberOr(form.get('calories'), 0),
        protein: numberOr(form.get('protein'), 0),
        image,
        note: String(form.get('note') || '').trim(),
        createdAt: Date.now()
    });
    saveState();
    closeModal();
    switchTab('nutrition');
}

async function handleMealPhoto(slot, files) {
    const file = files && files[0];
    if (!file) return;
    const image = await fileToImageData(file);
    const estimate = estimateCalories(slot, file);
    const label = slotLabel(slot);
    upsertMeal({
        id: uuid(),
        slot,
        title: `${label}照片分析`,
        calories: estimate.calories,
        protein: estimate.protein,
        image,
        note: estimate.note,
        createdAt: Date.now()
    });
    saveState();
    render();
    showToast(`${label}已估算 ${estimate.calories} kcal`);
}

function upsertMeal(meal) {
    const today = startOfDay(Date.now());
    state.meals = state.meals.filter((item) => !(startOfDay(item.createdAt) === today && item.slot === meal.slot));
    state.meals.push(meal);
}

function estimateCalories(slot, file) {
    const target = (MEAL_SLOTS.find((item) => item.id === slot) || MEAL_SLOTS[1]).target;
    const variance = (file.size % 260) - 110;
    const calories = clamp(Math.round((target + variance) / 10) * 10, 160, 1180);
    return {
        calories,
        protein: Math.max(8, Math.round(calories / 22)),
        note: '基于餐次、图片体积和本地启发式估算。接入视觉模型后可替换为真实食物识别。'
    };
}

async function startGestureCamera() {
    if (ui.gestureActive) return;
    const video = document.getElementById('gestureVideo');
    if (!video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        ui.gestureStatus = '当前 WebView 不支持摄像头流';
        updateGestureStatus();
        return;
    }
    try {
        gestureStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        video.srcObject = gestureStream;
        await video.play();
        ui.gestureActive = true;
        ui.gestureStatus = '识别中：挥手可生成下一页指令';
        previousGestureFrame = null;
        updateGestureStatus();
        analyzeGestureFrame();
    } catch (error) {
        ui.gestureStatus = `摄像头启动失败：${error.message || error}`;
        updateGestureStatus();
    }
}

function stopGestureCamera() {
    if (gestureLoopId) cancelAnimationFrame(gestureLoopId);
    gestureLoopId = 0;
    if (gestureStream) {
        gestureStream.getTracks().forEach((track) => track.stop());
    }
    gestureStream = null;
    previousGestureFrame = null;
    ui.gestureActive = false;
    ui.gestureStatus = '摄像头已关闭';
    updateGestureStatus();
    if (ui.tab === 'office') render();
}

function analyzeGestureFrame() {
    if (!ui.gestureActive) return;
    const video = document.getElementById('gestureVideo');
    const canvas = document.getElementById('gestureCanvas');
    if (!video || !canvas || video.readyState < 2) {
        gestureLoopId = requestAnimationFrame(analyzeGestureFrame);
        return;
    }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let diff = 0;
    let bright = 0;
    const current = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        current[j] = gray;
        bright += gray;
        if (previousGestureFrame) diff += Math.abs(gray - previousGestureFrame[j]);
    }
    const pixels = current.length;
    const motion = previousGestureFrame ? diff / pixels : 0;
    const brightness = bright / pixels;
    previousGestureFrame = current;

    let status = motion > 22 ? '检测到挥手动作' : brightness > 132 ? '检测到张掌待命' : '画面稳定，等待手势';
    ui.gestureStatus = `${status} · motion ${motion.toFixed(1)}`;
    updateGestureStatus();

    const now = Date.now();
    if (motion > 28 && now - ui.lastGestureAt > 2600) {
        triggerGesture('挥手', '下一页 / 下一个标签', false);
        ui.lastGestureAt = now;
    }
    gestureLoopId = requestAnimationFrame(analyzeGestureFrame);
}

function updateGestureStatus() {
    const target = document.getElementById('gestureStatus');
    if (target) target.textContent = ui.gestureStatus;
}

function triggerGesture(gesture, command, rerender = true) {
    state.commandLog.push({
        id: uuid(),
        gesture,
        command,
        status: '已记录',
        createdAt: Date.now()
    });
    state.pet.bond = clamp(state.pet.bond + 1, 0, 100);
    saveState();
    if (rerender && !(ui.gestureActive && ui.tab === 'office')) render();
}

function exportDesktopBridge() {
    const payload = JSON.stringify({
        app: 'Jarvis',
        protocol: 'opc-command-queue',
        commands: state.commandLog.slice(-10)
    }, null, 2);
    openModal('桌面桥接队列', `
        <div class="card">
            <strong>电脑端桥接协议</strong>
            <p class="subtle">移动端先把手势转换为结构化指令。电脑端守护进程读取队列后，可映射为快捷键、鼠标滚动或会议控制。</p>
        </div>
        <label class="field" style="margin-top:12px"><span>JSON</span><textarea readonly>${esc(payload)}</textarea></label>
    `);
}

function clearCommandLog() {
    state.commandLog = [];
    saveState();
    render();
}

function setOfficeMode(modeId, silent = false) {
    const mode = OFFICE_MODES.find((item) => item.id === modeId) || OFFICE_MODES[0];
    officeState().mode = mode.id;
    state.office.quietMode = mode.id === 'focus';
    triggerGesture('模式', mode.command, false);
    saveState();
    if (!silent) {
        render();
        showToast(`已切换到${mode.label}模式`);
    }
}

function startFocusSprint(minutes = 45, silent = false) {
    const duration = Number(minutes) || 45;
    const startsAt = Date.now();
    officeState().focusStartedAt = startsAt;
    state.office.focusMinutesToday = Number(state.office.focusMinutesToday || 0) + duration;
    state.office.quietMode = true;
    state.schedule.push({
        id: uuid(),
        type: 'focus',
        title: `Jarvis ${duration} 分钟专注冲刺`,
        startsAt,
        durationMinutes: duration,
        pillar: 'work',
        notes: `${currentOfficeMode().label}模式启动，建议结束后记录一句复盘。`,
        done: false,
        createdAt: Date.now()
    });
    triggerGesture('专注', `开启勿扰 / 计时 ${duration} 分钟`, false);
    saveState();
    if (!silent) {
        render();
        showToast(`已创建 ${duration} 分钟专注冲刺`);
    }
}

function logWater(silent = false) {
    state.habits.water = Number(state.habits.water || 0) + 1;
    state.pet.bond = clamp(state.pet.bond + 1, 0, 100);
    saveState();
    if (!silent) {
        render();
        showToast(`已记录第 ${state.habits.water} 杯水`);
    }
}

function logStandBreak(silent = false) {
    state.habits.stand = Number(state.habits.stand || 0) + 1;
    officeState().lastBreakAt = Date.now();
    state.pet.bond = clamp(state.pet.bond + 1, 0, 100);
    saveState();
    if (!silent) {
        render();
        showToast('已记录一次站立拉伸');
    }
}

function openDailyBrief() {
    const brief = dailyBriefText();
    officeState().lastBriefAt = Date.now();
    saveState();
    openModal('OPC 办公日报', `
        <div class="brief-list">
            ${brief.split('\n').map((line) => `<div class="brief-line">${esc(line)}</div>`).join('')}
        </div>
        <div class="asset-strip">
            <img src="opc-memory-agent.png" alt="OPC Agent 记忆">
            <img src="opc-sensing-demo.png" alt="OPC 感知演示">
        </div>
    `, '<button class="ghost-btn" onclick="closeModal()">关闭</button><button class="primary-btn" onclick="startFocusSprint()">安排专注</button>');
}

function dailyBriefText() {
    const today = startOfDay(Date.now());
    const todayItems = state.schedule.filter((item) => startOfDay(item.startsAt) === today);
    const done = todayItems.filter((item) => item.done);
    const open = todayItems.filter((item) => !item.done).sort((a, b) => a.startsAt - b.startsAt);
    const latestDiary = state.diaries.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
    return [
        `日期：${formatLongDate(Date.now())}`,
        `工作：完成 ${done.length} 项，待处理 ${open.length} 项，当前为${currentOfficeMode().label}模式。`,
        `健康：补水 ${state.habits.water} 杯，站立 ${state.habits.stand} 次，久坐状态 ${sittingRiskText()}。`,
        `饮食：今日记录 ${mealsToday().length} 餐，共 ${todayCalories()} kcal。`,
        `情绪：${latestDiary ? `${latestDiary.mood}，${latestDiary.text}` : '今天还没有记录心情。'}`,
        `下一步：${open[0] ? `${formatTime(open[0].startsAt)} 处理「${open[0].title}」` : '安排一个 45 分钟深度工作块。'}`
    ].join('\n');
}

function officeState() {
    if (!state.office) {
        state.office = {
            mode: 'focus',
            focusMinutesToday: 0,
            lastBreakAt: Date.now(),
            quietMode: false,
            lastBriefAt: 0
        };
    }
    return state.office;
}

function currentOfficeMode() {
    const mode = officeState().mode;
    return OFFICE_MODES.find((item) => item.id === mode) || OFFICE_MODES[0];
}

function officeModeFromText(text) {
    if (/会议模式|meeting mode|meeting/i.test(text)) return 'meeting';
    if (/演示模式|汇报模式|presentation|slide/i.test(text)) return 'presentation';
    if (/文档模式|写作模式|writing|document/i.test(text)) return 'writing';
    if (/专注模式|focus mode/i.test(text)) return 'focus';
    return '';
}

function officeLoadText() {
    const open = state.schedule.filter((item) => !item.done).length;
    const meetings = state.schedule.filter((item) => item.type === 'event' && !item.done).length;
    if (open >= 6 || meetings >= 3) return '高负荷';
    if (open >= 3 || meetings >= 1) return '中负荷';
    return '轻负荷';
}

function sittingMinutes() {
    const lastBreakAt = Number(officeState().lastBreakAt) || Date.now();
    return Math.round(clamp((Date.now() - lastBreakAt) / 60000, 0, 240));
}

function sittingRiskText() {
    const minutes = sittingMinutes();
    if (minutes >= 90) return '久坐偏高';
    if (minutes >= 55) return '建议起身';
    return '节奏正常';
}

function stressText() {
    const open = state.schedule.filter((item) => !item.done).length;
    const moodPenalty = Math.max(0, 70 - Number(state.habits.moodScore || 70));
    const light = Number(state.sensor && state.sensor.light);
    const lightPenalty = Number.isFinite(light) && light >= 0 && light < 80 ? 8 : 0;
    const score = open * 9 + moodPenalty + Math.round(sittingMinutes() / 5) + lightPenalty;
    if (score >= 78) return '压力偏高，建议拆分任务并先休息 5 分钟';
    if (score >= 45) return '压力中等，适合保留缓冲时间';
    return '压力可控，可以进入专注块';
}

function openChat() {
    openModal('Jarvis Agent', `
        <div class="chat-log" id="chatLog">${state.agentMessages.map(chatMessageHtml).join('')}</div>
        <form class="chat-input" id="chatForm" onsubmit="sendAgentMessage(event)">
            <textarea name="message" required placeholder="例如：明天 10 点安排路演彩排；记录我现在有点焦虑；午餐拍照估算热量"></textarea>
            <button class="primary-btn" type="submit">${iconSvg('send')}</button>
        </form>
    `, '', { full: true });
    setTimeout(() => {
        const log = document.getElementById('chatLog');
        if (log) log.scrollTop = log.scrollHeight;
    }, 0);
}

function chatMessageHtml(message) {
    return `
        <div class="chat-message ${message.role}">
            <span class="chat-avatar">${message.role === 'user' ? '我' : 'J'}</span>
            <div class="bubble ${message.role === 'user' ? 'user' : 'assistant'}">${esc(message.text)}</div>
        </div>
    `;
}

async function sendAgentMessage(event) {
    event.preventDefault();
    const textarea = event.target.elements.message;
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    state.agentMessages.push({ id: uuid(), role: 'user', text, createdAt: Date.now() });
    const loading = { id: uuid(), role: 'assistant', text: '正在思考...', createdAt: Date.now() };
    state.agentMessages.push(loading);
    saveState();
    openChat();

    const local = runLocalAgent(text);
    try {
        let reply = local.reply;
        if (state.settings.cloudAgent && state.settings.apiKey) {
            const cloud = await callCloudAgent(text);
            reply = `${cloud}\n\n本地执行：${local.summary}`;
        }
        loading.text = reply;
    } catch (error) {
        loading.text = `云端 Agent 暂不可用，已使用本地执行。\n${local.reply}`;
    }
    saveState();
    render();
    openChat();
}

function runLocalAgent(text) {
    const lower = text.toLowerCase();
    const actions = [];
    const requestedMode = officeModeFromText(text);

    if (requestedMode) {
        setOfficeMode(requestedMode, true);
        actions.push(`已切换到${currentOfficeMode().label}模式`);
    }

    if (/任务|提醒|日程|会议|开会|安排|todo|task|calendar|meeting/i.test(text) && !/模式|mode/i.test(text)) {
        const startsAt = parseNaturalTime(text);
        const type = /会议|开会|calendar|meeting/i.test(text) ? 'event' : /专注|task|深度/i.test(text) ? 'focus' : 'task';
        const title = cleanCommandTitle(text) || '新的办公任务';
        state.schedule.push({
            id: uuid(),
            type,
            title,
            startsAt,
            durationMinutes: type === 'focus' ? 60 : 30,
            pillar: 'work',
            notes: '由 Jarvis Agent 创建',
            done: false,
            createdAt: Date.now()
        });
        actions.push(`已添加${scheduleTypeLabel(type)}：${title}`);
    }

    if (/日记|心情|焦虑|开心|低落|孤独|疲惫|diary|mood/i.test(text)) {
        const mood = MOODS.find((item) => text.includes(item)) || (/焦虑/.test(text) ? '焦虑' : /疲惫/.test(text) ? '疲惫' : '稳定');
        state.diaries.push({
            id: uuid(),
            mood,
            text,
            image: '',
            createdAt: Date.now()
        });
        state.habits.moodScore = moodToScore(mood);
        actions.push(`已记录心情：${mood}`);
    }

    if (/早餐|午餐|晚餐|饮食|热量|吃了|meal|calorie|food/i.test(text)) {
        const slot = /早餐/.test(text) ? 'breakfast' : /晚餐|晚上/.test(text) ? 'dinner' : /加餐|零食/.test(text) ? 'other' : 'lunch';
        const estimate = estimateCalories(slot, { size: text.length * 4096 });
        upsertMeal({
            id: uuid(),
            slot,
            title: cleanCommandTitle(text) || `${slotLabel(slot)}记录`,
            calories: estimate.calories,
            protein: estimate.protein,
            image: '',
            note: '由文本描述生成的本地估算。',
            createdAt: Date.now()
        });
        actions.push(`已记录${slotLabel(slot)}：约 ${estimate.calories} kcal`);
    }

    if (/开始专注|开启专注|专注冲刺|focus sprint|start focus/i.test(text)) {
        const minuteMatch = text.match(/(\d{1,3})\s*(分钟|min|m)/i);
        const minutes = clamp(minuteMatch ? Number(minuteMatch[1]) : 45, 15, 120);
        startFocusSprint(minutes, true);
        actions.push(`已创建 ${minutes} 分钟专注冲刺`);
    }

    if (/补水|喝水|water/i.test(text)) {
        logWater(true);
        actions.push(`已记录补水，第 ${state.habits.water} 杯`);
    }

    if (/站立|拉伸|久坐|起身|break/i.test(text)) {
        logStandBreak(true);
        actions.push('已记录站立拉伸，久坐计时已复位');
    }

    if (/复盘|日报|总结|brief|review/i.test(text)) {
        officeState().lastBriefAt = Date.now();
        actions.push(`已生成办公日报：\n${dailyBriefText()}`);
    }

    if (/手势|挥手|静音|翻页|办公|gesture|slide|mute/i.test(lower)) {
        triggerGesture(/静音|mute/i.test(text) ? '张掌' : '挥手', /静音|mute/i.test(text) ? '会议静音' : '下一页 / 下一个标签', false);
        actions.push('已加入办公手势指令队列');
    }

    if (!actions.length) {
        actions.push('我可以继续帮你拆成任务、日程、饮食、日记或办公指令。');
    }

    state.pet.bond = clamp(state.pet.bond + 1, 0, 100);
    saveState();
    return {
        summary: actions.join('；'),
        reply: `${actions.join('；')}。\n\n${nextNudge()}`
    };
}

async function callCloudAgent(text) {
    const body = JSON.stringify({
        model: state.settings.modelName,
        messages: [
            {
                role: 'system',
                content: '你是 Jarvis，面向 OPC 办公人群的手机办公健康助手。回答要简洁，围绕日程、图文日记、饮食、心理健康、工作健康和手势办公控制。'
            },
            {
                role: 'user',
                content: text
            }
        ],
        temperature: 0.4
    });

    const raw = await postChatCompletions(state.settings.baseUrl, state.settings.apiKey, body);
    const data = safeJsonParse(raw);
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return content || '云端 Agent 已响应，但没有返回可读文本。';
}

function postChatCompletions(baseUrl, apiKey, body) {
    return new Promise((resolve, reject) => {
        const callbackId = uuid();
        nativeCallbacks[callbackId] = { resolve, reject };
        if (window.JarvisAndroid && window.JarvisAndroid.chatCompletions) {
            window.JarvisAndroid.chatCompletions(baseUrl, apiKey, body, callbackId);
            return;
        }
        fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body
        })
            .then((response) => response.text().then((text) => response.ok ? resolve(text) : reject(new Error(text))))
            .catch(reject);
    });
}

function openSideMenu() {
    openModal('Jarvis', `
        <div class="side-menu">
            <div class="card">
                <strong>面向 OPC 人群的办公助手</strong>
                <p class="subtle">围绕今日行动、计划时间线、工作模式、健康节奏和个人记忆组织办公闭环。</p>
            </div>
            ${NAV.map((item) => `
                <button class="row" onclick="closeModal(); switchTab('${item.id}')">
                    <span class="tool-icon">${iconSvg(item.icon)}</span>
                    <span class="row-main"><strong>${item.label}</strong><span class="subtle">${navDescription(item.id)}</span></span>
                </button>
            `).join('')}
            <button class="row" onclick="openSettings()">
                <span class="tool-icon">${iconSvg('settings')}</span>
                <span class="row-main"><strong>Agent 设置</strong><span class="subtle">配置云端模型和隐私策略</span></span>
            </button>
            <button class="row" onclick="resetDemoData()">
                <span class="tool-icon">${iconSvg('refresh')}</span>
                <span class="row-main"><strong>重置演示数据</strong><span class="subtle">恢复 Jarvis 初始体验</span></span>
            </button>
        </div>
    `, '', { side: true });
}

function openSettings() {
    openModal('Agent 设置', `
        <form id="settingsForm" class="form-grid" onsubmit="submitSettings(event)">
            <label class="field"><span>Base URL</span><input name="baseUrl" value="${attr(state.settings.baseUrl)}"></label>
            <label class="field"><span>API Key</span><input name="apiKey" value="${attr(state.settings.apiKey)}" placeholder="不填写则仅使用本地 Agent"></label>
            <label class="field"><span>Model</span><input name="modelName" value="${attr(state.settings.modelName)}"></label>
            <label class="field-inline">
                <input name="cloudAgent" type="checkbox" ${state.settings.cloudAgent ? 'checked' : ''}>
                <span>启用云端 Agent 增强回答</span>
            </label>
            <div class="card">
                <strong>隐私策略</strong>
                <p class="subtle">日程、日记、饮食照片和手势队列默认只保存在本机 localStorage。启用云端 Agent 后，仅聊天文本会发送到配置的接口。</p>
            </div>
        </form>
    `, modalActions('取消', '保存', 'settingsForm'));
}

function submitSettings(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    state.settings.baseUrl = String(form.get('baseUrl') || '').trim() || DEFAULT_AGENT_BASE_URL;
    state.settings.apiKey = String(form.get('apiKey') || '').trim();
    state.settings.modelName = String(form.get('modelName') || '').trim() || DEFAULT_AGENT_MODEL;
    state.settings.cloudAgent = form.get('cloudAgent') === 'on';
    saveState();
    closeModal();
    showToast('设置已保存');
}

function openSensorPanel() {
    refreshSensorSnapshot();
    openModal('多传感器输入', `
        <div class="grid-2">
            ${sensorCard('运动', sensorMotionText(), '加速度合成值')}
            ${sensorCard('环境光', sensorLightText(), 'Lux')}
            ${sensorCard('陀螺仪', gyroText(), '旋转状态')}
            ${sensorCard('电量', sensorBatteryText(), '设备续航')}
        </div>
        <section class="insight-band" style="margin-top:12px">
            <div class="section-head"><span class="section-title">Observe → Think → Act → Reflect</span></div>
            <p class="subtle">Jarvis 不保存原始传感器流，只保留低维摘要，用于判断久坐、移动、环境光和办公状态。</p>
        </section>
    `);
}

function sensorCard(title, value, detail) {
    return `<div class="card"><strong>${esc(title)}</strong><p class="subtle">${esc(value)}</p><span class="pill">${esc(detail)}</span></div>`;
}

function refreshSensorSnapshot() {
    try {
        if (window.JarvisAndroid && window.JarvisAndroid.getSensorSnapshot) {
            const raw = window.JarvisAndroid.getSensorSnapshot();
            state.sensor = typeof raw === 'string' ? JSON.parse(raw) : raw;
            saveState();
            updateSensorUi();
        }
    } catch (error) {
        updateSensorUi();
    }
}

function updateSensorUi() {
    const status = document.getElementById('statusLine');
    if (status) status.textContent = `OPC 办公助手 · ${sensorSummary()}`;
    const motion = document.getElementById('sensorMotion');
    if (motion) motion.textContent = sensorMotionText();
    const light = document.getElementById('sensorLight');
    if (light) light.textContent = sensorLightText();
    const battery = document.getElementById('sensorBattery');
    if (battery) battery.textContent = sensorBatteryText();
}

function resetDemoData() {
    state = defaultState();
    saveState();
    closeModal();
    render();
}

function healthScores() {
    const open = state.schedule.filter((item) => !item.done).length;
    const calories = todayCalories();
    const diary = state.diaries.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
    const sittingPenalty = sittingMinutes() >= 90 ? 10 : sittingMinutes() >= 55 ? 5 : 0;
    return {
        life: clamp(54 + state.habits.water * 5 + state.habits.stand * 2 + Math.min(mealsToday().length, 4) * 6 + (calories > 0 ? 8 : 0), 0, 99),
        mind: clamp((state.habits.moodScore || 70) + Math.round(state.pet.bond / 10) + (diary ? 6 : 0), 0, 99),
        work: clamp(84 - open * 6 + state.habits.focusBlocks * 5 + Math.round((state.office.focusMinutesToday || 0) / 45) - sittingPenalty, 0, 99)
    };
}

function nextNudge() {
    const open = state.schedule.filter((item) => !item.done).sort((a, b) => a.startsAt - b.startsAt)[0];
    if (open) return `${formatTime(open.startsAt)} 处理「${open.title}」，完成后建议记录一句复盘。`;
    if (!mealsToday().length) return '今天还没有饮食记录，可以先拍一张早餐或午餐。';
    return '今天节奏稳定，可以安排一个 45 分钟深度工作块。';
}

function monthlyReviewText() {
    const days = monthlyMealDays();
    const diaryCount = state.diaries.filter((item) => Date.now() - item.createdAt < 30 * 86400000).length;
    return `${days} 天饮食记录，${diaryCount} 条情绪记忆，${state.habits.focusBlocks} 个专注块`;
}

function sensorSummary() {
    if (!state.sensor || !state.sensor.updatedAt) return '等待传感器';
    return `${sensorMotionText()} / ${sensorLightText()}`;
}

function sensorFreshness() {
    if (!state.sensor || !state.sensor.updatedAt) return '未连接';
    const age = Math.round((Date.now() - state.sensor.updatedAt) / 1000);
    return age < 10 ? '实时' : `${age}s 前`;
}

function sensorMotionText() {
    const motion = Number(state.sensor && state.sensor.motion);
    if (!Number.isFinite(motion) || motion <= 0) return '暂无运动数据';
    if (motion > 14) return `移动中 ${motion.toFixed(1)}`;
    if (motion > 10.8) return `轻微晃动 ${motion.toFixed(1)}`;
    return `静置 ${motion.toFixed(1)}`;
}

function sensorLightText() {
    const light = Number(state.sensor && state.sensor.light);
    if (!Number.isFinite(light) || light < 0) return '暂无光照数据';
    if (light < 80) return `${Math.round(light)} lux，偏暗`;
    if (light > 1000) return `${Math.round(light)} lux，强光`;
    return `${Math.round(light)} lux，舒适`;
}

function sensorBatteryText() {
    const battery = Number(state.sensor && state.sensor.battery);
    if (!Number.isFinite(battery) || battery < 0) return '未知';
    return `${battery}%`;
}

function gyroText() {
    const gyro = (state.sensor && state.sensor.gyroscope) || [0, 0, 0];
    const power = Math.abs(gyro[0]) + Math.abs(gyro[1]) + Math.abs(gyro[2]);
    return power > 1.2 ? '设备旋转明显' : '设备姿态稳定';
}

function mealsToday() {
    const today = startOfDay(Date.now());
    return state.meals.filter((meal) => startOfDay(meal.createdAt) === today);
}

function todayCalories() {
    return mealsToday().reduce((sum, meal) => sum + Number(meal.calories || 0), 0);
}

function monthlyMealDays() {
    const recent = state.meals.filter((meal) => Date.now() - meal.createdAt < 30 * 86400000);
    return new Set(recent.map((meal) => inputDate(meal.createdAt))).size;
}

function moodToScore(mood) {
    return {
        开心: 88,
        专注: 82,
        稳定: 76,
        疲惫: 62,
        焦虑: 56,
        低落: 48
    }[mood] || 70;
}

function navDescription(id) {
    return {
        home: '办公驾驶舱和下一步',
        schedule: '任务、会议、专注时间线',
        office: '工作模式和手势控制',
        nutrition: '饮水、久坐、饮食和压力',
        diary: '日记、日报和长期记忆'
    }[id] || '';
}

function scheduleTypeLabel(type) {
    return {
        task: 'To-do',
        event: 'Calendar',
        focus: 'Task',
        health: '健康提醒'
    }[type] || '任务';
}

function pillarLabel(pillar) {
    return {
        life: '生活健康',
        mind: '心理健康',
        work: '工作健康'
    }[pillar] || '工作健康';
}

function slotLabel(slot) {
    return (MEAL_SLOTS.find((item) => item.id === slot) || MEAL_SLOTS[3]).label;
}

function parseNaturalTime(text) {
    let base = startOfDay(Date.now());
    if (/明天|tomorrow/i.test(text)) base = addDays(base, 1);
    if (/后天/i.test(text)) base = addDays(base, 2);
    let hour = 9;
    let minute = 0;
    const match = text.match(/(\d{1,2})(?::|点)?(\d{2})?/);
    if (match) {
        hour = Number(match[1]);
        minute = match[2] ? Number(match[2]) : 0;
        if (/下午|晚上|晚/i.test(text) && hour < 12) hour += 12;
    }
    return setTime(base, hour, minute);
}

function cleanCommandTitle(text) {
    return String(text || '')
        .replace(/请|帮我|添加|安排|提醒|记录|日程|任务|会议|开会|日记|心情|饮食|热量|手势|办公/g, '')
        .replace(/明天|后天|今天|上午|下午|晚上|\d{1,2}(:|点)?\d{0,2}/g, '')
        .replace(/[，。,.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);
}

function openModal(title, body, footer = '<button class="primary-btn" onclick="closeModal()">完成</button>', options = {}) {
    const classes = ['modal'];
    if (options.full) classes.push('full');
    if (options.side) classes.push('side');
    document.getElementById('modalHost').innerHTML = `
        <div class="modal-backdrop">
            <section class="${classes.join(' ')}">
                <header class="modal-head">
                    <h2>${esc(title)}</h2>
                    <span class="spacer"></span>
                    <button class="icon-btn" onclick="closeModal()" aria-label="关闭">${iconSvg('close')}</button>
                </header>
                <div class="modal-body">${body}</div>
                ${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}
            </section>
        </div>
    `;
}

function closeModal() {
    document.getElementById('modalHost').innerHTML = '';
}

function modalActions(cancel, submit, formId) {
    return `<button class="ghost-btn" onclick="closeModal()" type="button">${cancel}</button><button class="primary-btn" type="submit" form="${formId}">${submit}</button>`;
}

function showToast(message) {
    openModal('完成', `<div class="card"><strong>${esc(message)}</strong><p class="subtle">${esc(nextNudge())}</p></div>`);
    setTimeout(() => {
        const host = document.getElementById('modalHost');
        if (host && host.textContent.includes(message)) closeModal();
    }, 1100);
}

function fileToImageData(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => resolve(reader.result);
            image.onload = () => {
                const max = 900;
                const scale = Math.min(1, max / Math.max(image.width, image.height));
                const width = Math.max(1, Math.round(image.width * scale));
                const height = Math.max(1, Math.round(image.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d');
                context.drawImage(image, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function safeJsonParse(raw, fallback = null) {
    if (!raw) return fallback;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function readArkError(data) {
    return data && data.error && (data.error.message || data.error.code);
}

function numberOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `id-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function attr(value) {
    return esc(value).replace(/`/g, '&#96;');
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function startOfDay(ts) {
    const date = new Date(ts);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function addDays(ts, days) {
    const date = new Date(ts);
    date.setDate(date.getDate() + days);
    return date.getTime();
}

function setTime(ts, hour, minute) {
    const date = new Date(ts);
    date.setHours(hour, minute || 0, 0, 0);
    return date.getTime();
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function inputDateTime(ts) {
    const date = new Date(ts);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inputDate(ts) {
    const date = new Date(ts);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatShortDate(ts) {
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function formatLongDate(ts) {
    return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function iconSvg(name) {
    const icons = {
        home: '<path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10"></path><path d="M9 20v-6h6v6"></path>',
        radar: '<path d="M12 12h.01"></path><path d="M19.07 4.93a10 10 0 1 1-14.14 0"></path><path d="M15.54 8.46a5 5 0 1 1-7.08 0"></path><path d="m12 12 4-4"></path>',
        calendar: '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18"></path>',
        heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"></path>',
        meal: '<path d="M4 3v9"></path><path d="M8 3v9"></path><path d="M4 7h4"></path><path d="M6 12v9"></path><path d="M15 3c2 2 3 4 3 7v11"></path><path d="M15 10h6"></path>',
        hand: '<path d="M8 13V5a2 2 0 0 1 4 0v7"></path><path d="M12 12V4a2 2 0 0 1 4 0v9"></path><path d="M16 13V7a2 2 0 0 1 4 0v8a6 6 0 0 1-12 0v-2"></path><path d="M8 13a2 2 0 1 0-4 0v2a8 8 0 0 0 8 8"></path>',
        plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
        edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
        camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"></path><circle cx="12" cy="13" r="3"></circle>',
        monitor: '<rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path>',
        target: '<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M2 12h3"></path><path d="M19 12h3"></path>',
        cup: '<path d="M5 8h11v7a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5Z"></path><path d="M16 10h2a3 3 0 0 1 0 6h-2"></path><path d="M7 4h7"></path>',
        stretch: '<circle cx="12" cy="5" r="2"></circle><path d="M12 7v7"></path><path d="M5 10h14"></path><path d="m8 21 4-7 4 7"></path>',
        brief: '<path d="M9 3h6l1 3h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3Z"></path><path d="M8 12h8"></path><path d="M8 16h5"></path>',
        video: '<rect x="3" y="6" width="12" height="12" rx="2"></rect><path d="m15 10 5-3v10l-5-3Z"></path>',
        presentation: '<path d="M3 4h18v12H3Z"></path><path d="M12 16v5"></path><path d="m8 21 4-5 4 5"></path>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h5"></path>',
        pause: '<path d="M8 5v14"></path><path d="M16 5v14"></path>',
        check: '<path d="m20 6-11 11-5-5"></path>',
        send: '<path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4Z"></path>',
        settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.03.03a2 2 0 0 1-2.83 2.83l-.03-.03A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.03.03a2 2 0 0 1-2.83-2.83l.03-.03A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.03-.03a2 2 0 0 1 2.83-2.83l.03.03A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.03-.03a2 2 0 0 1 2.83 2.83l-.03.03A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.05A1.7 1.7 0 0 0 19.4 15Z"></path>',
        refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"></path><path d="M3 12A9 9 0 0 1 18.5 5.8"></path><path d="M3 17v5h5"></path><path d="M21 7V2h-5"></path>',
        close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
    };
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.radar}</svg>`;
}
