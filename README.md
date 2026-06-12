# MEM Analyzer Web

基于最大熵法（MEM）的 Web 端和频光谱（SFG）分析平台。提供三个主要功能模块：MEM 光谱重建、SFG 光谱生成器、MEM 与拟合结果对比。

## 项目架构

```
MEMweb/
├── backend/
│   ├── main.py                       # FastAPI 应用入口，所有 API 路由
│   ├── memnum.py                     # MEM 核心算法（从 MEMPy 移植）
│   ├── sfg_generator.py              # Lorentzian SFG 光谱计算
│   ├── spectral_utils.py             # CSV 解析、相位旋转、数据导出
│   └── requirements.txt
│
├── frontend/
│   ├── vite.config.ts                # Vite 配置（含 /api 代理）
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx                   # 顶层布局（Header + Tabs 导航）
│   │   ├── main.tsx                  # React 入口
│   │   ├── pages/
│   │   │   ├── MemAnalyzerPage.tsx   # 标签 1：MEM 光谱分析器
│   │   │   ├── SfgGeneratorPage.tsx  # 标签 2：SFG 光谱生成器
│   │   │   └── MemVsFittingPage.tsx  # 标签 3：MEM vs Fitting 对比
│   │   ├── components/
│   │   │   ├── UploadPanel.tsx       # MEM 文件上传 & 参数设置
│   │   │   ├── IntensityChart.tsx    # 强度谱图（Plotly.js）
│   │   │   ├── ComplexChart.tsx      # 复谱图 Re[χ]/Im[χ]（Plotly.js）
│   │   │   ├── PhaseControl.tsx      # 误差相位滑块 & 导出按钮
│   │   │   ├── ExportButton.tsx      # CSV 导出按钮
│   │   │   └── ErrorBoundary.tsx     # React 渲染错误边界
│   │   ├── hooks/
│   │   │   └── useMemResult.ts       # MEM 结果状态管理 Hook
│   │   ├── api/
│   │   │   └── mem.ts                # Axios API 封装（所有端点）
│   │   └── types/
│   │       └── mem.ts               # TypeScript 类型定义
│   └── ...
│
└── run.bat                           # 一键启动脚本（Dev / Prod 模式）
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | FastAPI, NumPy, SciPy, Pandas |
| 前端 | React 19, TypeScript, Ant Design 6, Plotly.js |
| 构建 | Vite 8, Uvicorn, Axios |

## 快速开始

### 环境要求

- **Python 3.10+**（推荐 conda 环境，`run.bat` 默认指向 `D:\Anaconda\envs\py310`）
- **Node.js 20+**（含 npm）

> **新电脑部署注意**：若提示 `npm: command not found`，说明未安装 Node.js。
> 前往 [https://nodejs.org](https://nodejs.org) 下载 LTS 版本安装，安装完成后**重新打开命令行窗口**，
> 执行 `npm install`（仅首次）再 `npm run dev`。

### 首次运行

```bash
cd frontend && npm install            # 仅首次，安装前端依赖
```

### 启动

双击 `run.bat`，选择运行模式：

- **`[1] Dev Mode`** — 分别在两个窗口中启动后端（`:8000`）和前端（`:3000`）。前端支持热更新。访问 `http://localhost:3000`。
- **`[2] Prod Mode`** — 构建前端后由后端托管静态文件，单端口服务。访问 `http://localhost:8000`。

### 手动启动

```bash
# 开发模式
cd backend && python main.py           # 终端 1
cd frontend && npm run dev             # 终端 2

# 生产模式
cd frontend && npm run build
cd backend && python main.py           # 访问 :8000
```

## 页面功能

### 标签 1：MEM Analyzer

从实验强度谱 |χ(ω)|² 出发，通过最大熵法重建复磁化率 χ(ω)。

| 区域 | 说明 |
|------|------|
| Data Setup | 上传 CSV → 选择列 → 设置 NN → Run MEM |
| 强度谱图 | 展示原始 |χ|²，用于参考 |
| 复谱图 | Re[χ] 与 Im[χ] 曲线，随相位滑块实时旋转 |
| 误差相位调节 | 滑块 0 ~ 2π + 精确数值输入 + Reset + 导出 CSV |

### 标签 2：SFG Generator

根据 Lorentzian 参数生成 SFG 光谱。

```
χ(ω) = A_NR + Σ A_q · e^(i·φ_q) / (ω_q − ω − i·Γ_q)
```

| 功能 | 说明 |
|------|------|
| 参数面板 | 波数范围、NR 实部/虚部、动态峰参数（振幅/中心/宽度/相位） |
| 文件导入 | 支持 `.txt` 文件批量导入 `A{n}/Omega{n}/Gamma{n}/Phi{n}` 参数 |
| 三图显示 | 强度、实部、虚部 — 各自上下排列 |
| 子峰叠加 | 开关控制是否用虚线显示各峰分量 |
| CSV 导出 | 含总谱与各子峰分量 |

**参数文件格式示例** (`parameters.txt`)：

```
NR_Real=1
NR_Imag=0
A1=1
Omega1=2990
Gamma1=3
Phi1=0.5
A2=2
Omega2=2950
Gamma2=4
```

`Phi` 行可选，缺失时默认为 0。以 `#` 开头的行为注释。

### 标签 3：MEM vs Fitting

将 MEM 重建结果与用户提供的拟合参数生成的光谱进行对比。

| 功能 | 说明 |
|------|------|
| Data Setup | 上传实验 CSV + 选择列 + 设置 NN |
| Fitting Parameters | 输入/导入拟合参数（NR 实部/虚部 + 峰参数含相位），与 SFG Generator 格式一致 |
| 对比图 | MEM Re[χ]/Im[χ]（实线） vs Fitting Re[χ]/Im[χ]（虚线）叠绘 |
| 误差相位滑块 | 拖动 φ 实时旋转 MEM 曲线 |
| 差异曲线 | 实部/虚部各自的 Σ|diff| vs φ 图，当前相位位置用虚线游标标出 |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/mem/run` | 上传 CSV → MEM 计算 |
| `POST` | `/api/mem/phase` | 误差相位旋转 |
| `POST` | `/api/mem/compare` | CSV + 拟合参数 → MEM 与拟合光谱对比 |
| `POST` | `/api/sfg/generate` | Lorentzian 参数 → SFG 光谱 |

### `POST /api/mem/run`

请求：`multipart/form-data`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `file` | file | 是 | — | CSV 文件（波数 + 强度列） |
| `nn` | int | 否 | `min(1024, N//2)` | 时间域点数 |
| `nnout` | int | 否 | `N` | 输出频率点数 |
| `column` | int | 否 | `1` | 强度列索引 |

响应：

```json
{
  "wavenumbers": [2800.0, 2800.5, ...],
  "original_intensity": [0.001, 0.002, ...],
  "real_part": [0.03, 0.032, ...],
  "imag_part": [-0.015, -0.014, ...],
  "peak_intensity": 0.15,
  "n_points": 1000, "nn": 500
}
```

### `POST /api/mem/phase`

请求：`application/json`

```json
{ "phase_angle": 1.57, "real_part": [...], "imag_part": [...] }
```

响应：`{ "real_part": [...], "imag_part": [...] }`

### `POST /api/sfg/generate`

请求：`application/json`

| 字段 | 类型 | 说明 |
|------|------|------|
| `xmin` | float | 波数起始 |
| `xmax` | float | 波数终止 |
| `npoints` | int | 数据点数（10 ~ 10000） |
| `nr_real` | float | NR 实部 |
| `nr_imag` | float | NR 虚部 |
| `peaks` | list | 峰参数，每项含 `amplitude`, `center`, `width`, `phase` |

响应：

```json
{
  "wavenumbers": [...], "intensity": [...],
  "real_part": [...], "imag_part": [...],
  "sub_components": [{ "label": "Peak 1", "intensity": [...], "real": [...], "imag": [...] }, ...]
}
```

### `POST /api/mem/compare`

请求：`multipart/form-data`

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | file | CSV 数据文件 |
| `nn` | int | MEM NN（可选） |
| `column` | int | 强度列索引（可选） |
| `params_json` | string | JSON 格式的拟合参数（同 SFG Generator 格式） |

响应：

```json
{
  "wavenumbers": [...],
  "mem_real": [...], "mem_imag": [...],
  "fitting_real": [...], "fitting_imag": [...],
  "n_points": 1000, "nn": 500
}
```

## CSV 格式

**输入** — 与 MEMPy 兼容：

```
WN,Int
2800.0,0.0012
2800.5,0.0015
...
```

支持带/不带表头。第一列为波数。数据自动按波数升序排列。

**输出** — MEM Analyzer 导出格式：

```
Wavenumber,Re_Chi,Im_Chi
2800.000000,8.78283326e-03,-1.93211660e-02
```

SFG Generator 导出包含总谱与各子峰分量。

## MEM 算法

基于 Yang 和 Huang（*J. Opt. Soc. Am. B*, 2000）提出、De Beer 和 Roke（EPFL, 2011）应用于 SFG 光谱学的最大熵法。

计算流程：逆 FFT（`np.fft.fft`，匹配 Mathematica `InverseFourier` 的负指数约定）→ Hermitian Toeplitz 自相关矩阵 → 线性求解 → MEDIAN 强度匹配缩放 → 输出 χ(ω)。误差相位通过 `χ_rot = χ · e^(iφ)` 校准。

## SFG 光谱公式

χ(ω) 由非共振项与多个 Lorentzian 峰叠加：

```
χ(ω) = NR_Real + i·NR_Imag + Σ_q A_q · e^(i·φ_q) / (ω_q − ω − i·Γ_q)
```

| 参数 | 含义 |
|------|------|
| `NR_Real`, `NR_Imag` | 非共振复振幅 |
| `A_q` | 第 q 峰的振幅 |
| `ω_q` | 第 q 峰的中心波数 |
| `Γ_q` | 第 q 峰的宽度（半高半宽） |
| `φ_q` | 第 q 峰的相位（rad，可选，默认 0） |

强度 = |χ(ω)|²，实部 = Re[χ]，虚部 = Im[χ]。

## 关联项目

| 项目 | 说明 |
|------|------|
| `../MEMPy/` | 原版 Tkinter 桌面 GUI（MEM 算法参考实现） |
| `../SFG generator/` | 原版 Tkinter SFG 生成器（UI 参考） |
| `../TestData/` | 标准测试数据集 |
