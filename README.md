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
| Data Setup | 上传 CSV → 选择列 → 设置 NN 与 MEM calculation points → Run MEM |
| 强度谱图 | 同图展示原始 |χ|² 与重采样/插值后的 MEM 输入谱 |
| 复谱图 | Re[χ] 与 Im[χ] 曲线，随相位滑块实时旋转 |
| 误差相位调节 | 滑块 0 ~ 2π + 精确数值输入 + Reset + 导出 CSV |

### 标签 2：SFG Generator

根据 Lorentzian 或 Voigt 参数生成复 SFG 光谱。

```
χ(ω) = A_NR + Σ A_q · e^(i·φ_q) / (ω_q − ω − i·Γ_q)
```

| 功能 | 说明 |
|------|------|
| 参数面板 | 波数范围、NR 实部/虚部、动态峰参数（线形/振幅/中心/Lorentzian HWHM/Gaussian FWHM/相位） |
| 文件导入 | 支持 `.txt` / `.csv` peak parameter file 批量导入 `A{n}/Omega{n}/Gamma{n}/Phi{n}` 参数；缺少线形字段时默认 Lorentzian |
| 三图显示 | 强度、实部、虚部 — 各自上下排列 |
| 子峰叠加 | 开关控制是否用虚线显示各峰分量 |
| CSV 导出 | 含总谱与各子峰分量；peak parameter 导出会注明当前 Phase unit |

**Peak parameter file 格式示例** (`parameters.txt`)：

```
NR_Real=1
NR_Imag=0
Profile1=lorentzian
A1=1
Omega1=2990
Gamma1=3
Gaussian_FWHM1=0
Phi1=90
Profile2=voigt
A2=2
Omega2=2950
Gamma2=4
Gaussian_FWHM2=12
```

`Profile`、`Gaussian_FWHM` 和 `Phi` 行可选，缺失时分别默认为 `lorentzian`、`0` 和 `0`。以 `#` 开头的行为注释。旧格式文件只含 `A{n}/Omega{n}/Gamma{n}/Phi{n}` 时仍按 Lorentzian 导入。

### Lorentzian and Voigt peak profiles / 峰线形

当前程序保留原有 Lorentzian 复响应约定：

```
χ_q(ω) = A_q exp(iφ_q) / (ω_q − ω − iΓ_q)
```

其中 `Gamma` / `width` / `Γ_q` 按旧程序定义为 Lorentzian HWHM（半高半宽），不是 FWHM。为了不改变旧参数文件的含义，`Gamma1=3` 仍表示 `Γ=3 cm^-1`。对应 Lorentzian FWHM 为 `2Γ`。

Voigt 峰使用的是 `backend/spectrum_models.py` 中的 `complex_voigt()` 函数。该函数调用 SciPy 的 `scipy.special.wofz`，也就是 Faddeeva function：

```
w(z) = exp(-z^2) erfc(-i z)
```

程序实现的是 **complex Voigt response**，即 Gaussian 非均匀展宽作用在复 Lorentzian 响应上，而不是只返回实数强度线形的 Voigt profile。代码中的定义为：

```
sigma = Gaussian_FWHM / (2 sqrt(2 ln 2))
z = (omega - omega_q + i Gamma_q) / (sigma sqrt(2))
V_complex(omega) = i sqrt(pi) wofz(z) / (sigma sqrt(2))
chi_q(omega) = A_q exp(i phi_q) V_complex(omega)
```

其中 `Gamma` / `width` / `Γ_q` 仍是 Lorentzian HWHM，`Gaussian_FWHM` 在 GUI 和参数文件中使用 FWHM，内部再转换为 `sigma`。程序不会对最终强度 `|χ|^2` 做卷积；总强度始终由总复响应计算：

```
Intensity(ω) = |χ_NR + Σχ_q(ω)|^2
```

当 `Profile=voigt` 且 `Gaussian_FWHM=0` 时，`complex_voigt()` 会直接退化为原来的 Lorentzian 复响应。

### Phase unit for Phi import/export / Phi 相位单位

`SFG Generator` 和 `MEM vs Fitting` 的 peak parameter 面板使用统一的 `Phase unit` 控件控制 `Phi` 的显示、手动输入、参数文件导入和参数文件导出。可选值为 `Degrees (°)` 与 `Radians (rad)`，默认值为 `Degrees (°)`。

后端计算始终使用 radians。当前端选择 `Degrees (°)` 时，面板中的 `Phi=90` 会在发送给后端前转换为 `π/2 rad`；当前端选择 `Radians (rad)` 时，面板中的 `Phi=1.5708` 会直接作为弧度值发送给后端。

导入 `.txt` 或 `.csv` peak parameter file 时，程序不会要求文件包含 `phase_unit` 字段，也不会根据数值大小自动猜测单位。导入的 `Phi` 数值始终按照当前 GUI 中选择的 `Phase unit` 解释。因此，若使用旧格式的弧度制 peak parameter file，请先把 `Phase unit` 切换到 `Radians (rad)`，再执行导入。

切换 `Degrees (°)` 与 `Radians (rad)` 时，当前面板中已有的全部 `Phi` 数值会自动换算，物理相位保持不变。例如 `90°` 切换到 radians 后显示约 `1.5708 rad`，再切回 degrees 后显示约 `90°`。

导出 peak parameter file 时，`Phi` 会按照当前 GUI 选择的 `Phase unit` 输出；导出文件开头会写入类似 `# Phase unit: degrees` 或 `# Phase unit: radians` 的说明。

### 标签 3：MEM vs Fitting

将 MEM 重建结果与用户提供的 peak parameters 生成的理想光谱进行对比。

`Peak parameters` 指用于生成或比较 SFG 光谱的 Lorentzian/Voigt 峰参数。它们可以由用户手动输入、从文件导入，也可以来自拟合结果；如果确实特指拟合得到的参数，README 中使用 `fitted peak parameters` 表述。

| 功能 | 说明 |
|------|------|
| Data Setup | 上传实验 CSV + 选择列 + 设置 NN 与 MEM calculation points |
| Peak Parameters | 输入/导入 peak parameters（NR 实部/虚部 + 峰参数含相位），与 SFG Generator 格式一致；`Phase unit` 控制 Phi 的显示、导入和导出 |
| 对比图 | MEM Re[χ]/Im[χ]（实线） vs ideal Re[χ]/Im[χ] from peak parameters（虚线）叠绘 |
| 误差相位滑块 | 以 degree 输入/选择 error phase，并实时旋转 MEM 曲线 |
| NRMSE 曲线 | Re-NRMSE 与 Im-NRMSE vs error phase 图，并标出各自最小值和当前展示 phase |

## MEM Calculation Points / MEM 计算点数

`MEM calculation points` 记为 `N_MEM`，用于控制实际送入 MEM 内部计算的均匀频率网格点数。它与原始光谱点数 `N_original` 不同：

- `N_original`：原始导入或生成光谱的实际数据点数。
- `N_MEM`：MEM 内部计算使用的均匀频率网格点数。

默认情况下，程序令 `N_MEM = N_original`。如果原始频率轴已经均匀，MEM 会直接使用原始网格；如果原始频率轴不均匀，程序会在相同频率范围内生成均匀的 MEM 输入轴，并把强度谱映射到该轴。

当 `N_MEM > N_original` 时，程序通过一维插值生成更密的 MEM 计算网格。这可能使显示曲线更平滑，或用于研究 FFT 数组长度、MEM 数值网格对结果的影响；但它不会增加原始实验或模拟光谱所包含的独立信息，也不能理解为提高真实光谱分辨率。

当 `N_MEM < N_original` 时，程序会把光谱重采样到更稀疏的 MEM 输入网格。这可能减少计算量，但也可能降低对窄峰、肩峰或快速相位变化的保留能力。

推荐用法：

1. 日常处理真实实验光谱时，建议默认使用 `N_MEM = N_original`。
2. 只有在研究数值网格、重采样、FFT 数组长度或 MEM 稳定性时，才系统扫描不同的 `N_MEM`。
3. 若研究“原始采样点数对 MEM 的影响”，不应只对同一条谱插值后比较；应从相同理想模型直接生成不同原始采样密度的光谱，并优先令 `N_MEM = N_original`。

GUI 使用步骤：

1. 导入 CSV 光谱。
2. 查看程序识别到的原始点数 `N_original`。
3. 在 MEM 参数区域输入目标 `MEM calculation points / MEM 计算点数`。
4. 点击 `Run MEM` 或 `Run MEM & Compare`。
5. 查看原始谱、MEM 输入谱和重构 Re/Im 结果。
6. 从状态栏或导出的 CSV 中确认本次 `N_original`、`N_MEM`、频率范围和重采样方式。

限制与注意事项：

- 通过插值增加 `N_MEM` 不等于增加实验信息。
- 当前 GUI/API 限制 `N_MEM <= 20000`，过大的 `N_MEM` 会增加内存占用与计算时间。
- `NN` 必须满足 `2 <= NN < N_MEM`。
- 不同 `N_MEM` 下的 MEM 结果应优先通过 Re-NRMSE、Im-NRMSE 或其他明确的定量指标比较，不能只凭曲线是否更平滑判断优劣。

## NRMSE 误差评估与 Error Phase 优化

`MEM vs Fitting` 页面会在 error phase 扫描中计算 NRMSE。NRMSE = Normalized Root Mean Square Error（归一化均方根误差），用于比较 MEM 重构的复谱与 peak parameters 生成的理想谱之间的相对误差，并辅助寻找更合适的 error phase。NRMSE 是当前 GUI 推荐且默认使用的 error-phase optimization metric。

程序分别计算 Re-NRMSE 与 Im-NRMSE，因为实部和虚部的幅度、背景、相位敏感性可能不同；两个分量的最佳 error phase 不一定完全相同。

### Error phase input unit / Error phase 输入单位

GUI 中的 error phase 手动输入、phase scan 起点、终点和步长都使用 degree（°）。默认 phase scan 覆盖完整一圈 `0°` 到 `360°`；例如 `start = 0`、`end = 360`、`step = 0.5` 表示从 `0°` 到 `360°`，每 `0.5°` 扫描一次。

后端和复谱旋转仍统一使用 radians。前端会在调用 error phase correction 或计算 phase scan 指标前自动执行：

```
phi_rad = phi_deg * pi / 180
```

界面会同时显示当前选择相位的 degree 与对应 internal phase（radian），例如 `30.00° = 0.523599 rad`。用户不需要手动把 degree 换算成 radian。后端 `/api/mem/phase` 接口仍保持兼容，`phase_angle` 字段含义仍为 radians。

### Default displayed reconstruction / 默认展示的重构谱

完成 error phase scan 后，如果用户尚未手动选择其他 phase，主 Re/Im 对比图会自动展示 Im-NRMSE 最小对应的 MEM 重构谱：

- 未启用 selected spectral window 时，默认使用 full-range minimum Im-NRMSE 对应的 phase。
- 启用 selected spectral window 且窗口有效时，默认使用 selected-window minimum Im-NRMSE 对应的 phase。

结果区会显示 default displayed phase（degree）、equivalent internal phase（radian）、selection criterion、minimum Im-NRMSE，以及同一 phase 下的 Re-NRMSE。默认展示 phase 不一定与 Re-NRMSE 最小 phase 相同；这里优先选择 Im-NRMSE 最小，是为了优先展示虚部恢复最佳的结果。

用户仍可通过 phase scan 图点击某个 phase，或在 `Selected error phase (°)` 输入框中手动输入其他 phase。手动切换后，主图标题和 phase scan 图中的竖线标记会同步更新。

对每一个 error phase `φ`，先计算残差：

```
r_Re,i(φ) = Re_MEM,i(φ) - Re_ideal,i
r_Im,i(φ) = Im_MEM,i(φ) - Im_ideal,i
```

再计算对应分量的 NRMSE：

```
NRMSE_Re(φ) = RMSE(r_Re(φ)) / RMS(Re_ideal)
NRMSE_Im(φ) = RMSE(r_Im(φ)) / RMS(Im_ideal)
```

其中 `RMSE` 是残差的均方根，`RMS` 是对应理想谱分量的均方根幅度。NRMSE 是无量纲数值，越小表示 MEM 重构谱越接近理想谱。若理想 Re 或 Im 的 RMS 接近 0，程序会使用很小的 epsilon 作为归一化下限，避免除以零、NaN 或 Inf，并在结果区与导出文件中提示。

旧的 absolute residual sum、MAE 或 residual standard deviation 不再作为 GUI 默认指标，也不再作为默认导出的 phase scan 指标。当前推荐使用 NRMSE 的原因：

- 绝对残差和会受数据点数影响；
- 绝对残差和会受整体谱强度影响；
- NRMSE 是无量纲指标，更适合比较不同模型、不同峰强、不同非共振项、不同点数和不同噪声条件。

使用方法：

1. 在 `MEM vs Fitting` 页面导入实验或模拟 CSV。
2. 输入或导入 peak parameters，运行 `Run MEM & Compare`。
3. 程序会自动扫描 error phase，并显示 `NRMSE for Error-Phase Optimization` 图。
4. 查看图中的 Re-NRMSE 和 Im-NRMSE 曲线。
5. 读取结果区显示的 minimum Re-NRMSE、optimal phase for Re-NRMSE、minimum Im-NRMSE 和 optimal phase for Im-NRMSE。

注意事项：

- Re 和 Im 的最佳 error phase 不一定完全相同。
- NRMSE 越小，表示 MEM 重构与理想谱越接近。
- 不应只根据谱线是否平滑判断 MEM 重构质量。
- NRMSE 只在 MEM Re/Im 与 ideal Re/Im 已严格对齐到相同频率轴、相同点数、相同数组顺序时计算。

### Selected spectral window NRMSE / 分段 NRMSE

除了 full-range NRMSE，`MEM vs Fitting` 页面还支持 selected spectral window NRMSE（分段 NRMSE）。该功能只使用用户指定波数区间内的数据点，用于评价某个局部谱段中 MEM 重构谱与理想谱的匹配程度。

Full-range NRMSE 与 selected-window NRMSE 的区别：

- Full-range NRMSE 反映完整光谱范围内的总体重构质量。
- Selected-window NRMSE 反映用户选择的局部波数区间内的重构质量。
- 两者同时保留，不互相替代。

当多峰相距较远或谱形较复杂时，单一 error phase 可能不能同时使所有谱段达到最佳匹配。因此，局部窗口的最佳 phase 可能与 full-range 最佳 phase 不同。

对于窗口 `[ω_min, ω_max]`，程序只使用满足 `ω_min <= ω_i <= ω_max` 的数据点计算 NRMSE：

```
NRMSE_Re,window(φ) = RMSE(r_Re(φ) in selected window) / RMS(Re_ideal in selected window)
NRMSE_Im,window(φ) = RMSE(r_Im(φ) in selected window) / RMS(Im_ideal in selected window)
```

窗口点由实际波数值筛选，不按数组索引或固定百分比截取。若用户输入的窗口超出光谱范围，程序会使用与当前光谱范围的有效交集，并显示实际使用的起止波数和窗口点数。窗口必须至少包含 3 个数据点。

使用步骤：

1. 在 `MEM vs Fitting` 页面运行 `Run MEM & Compare`。
2. 在 `NRMSE for Error-Phase Optimization` 区域启用 `Enable selected spectral window NRMSE`。
3. 输入 `Window start` 与 `Window end`。
4. 比较 full-range 与 selected-window 的 Re-NRMSE / Im-NRMSE 曲线。
5. 分别读取 full-range 与 selected-window 的最小 NRMSE 及对应 optimal phase。

注意事项：

- 分段 NRMSE 只评价选定区间。
- 局部 NRMSE 很小并不代表整条谱都恢复良好。
- 应结合 full-range NRMSE、分段 NRMSE、残差谱和 Re/Im 谱形共同判断 MEM 恢复质量。
- 若窗口内 ideal Re 或 Im 的 RMS 接近 0，程序同样使用 epsilon 作为归一化下限并显示提示。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/mem/run` | 上传 CSV → MEM 计算 |
| `POST` | `/api/mem/phase` | 误差相位旋转 |
| `POST` | `/api/mem/compare` | CSV + peak parameters → MEM 与 peak-parameter ideal spectrum 对比 |
| `POST` | `/api/sfg/generate` | Lorentzian 参数 → SFG 光谱 |

### `POST /api/mem/run`

请求：`multipart/form-data`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `file` | file | 是 | — | CSV 文件（波数 + 强度列） |
| `nn` | int | 否 | `min(1024, N_MEM//2)` | 时间域点数，必须满足 `2 <= NN < N_MEM` |
| `mem_points` | int | 否 | `N_original` | MEM 内部均匀频率网格点数 `N_MEM` |
| `column` | int | 否 | `1` | 强度列索引 |

响应：

```json
{
  "wavenumbers": [2800.0, 2800.2, ...],
  "original_wavenumbers": [2800.0, 2800.5, ...],
  "mem_wavenumbers": [2800.0, 2800.2, ...],
  "original_intensity": [0.001, 0.002, ...],
  "mem_input_intensity": [0.001, 0.0014, ...],
  "real_part": [0.03, 0.032, ...],
  "imag_part": [-0.015, -0.014, ...],
  "peak_intensity": 0.15,
  "n_original": 1000,
  "n_mem": 2500,
  "nn": 500,
  "resampling_method": "Interpolated from 1000 to 2500 points"
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
| `peaks` | list | 峰参数，每项含 `profile_type`, `amplitude`, `center`, `width`, `gaussian_fwhm`, `phase`；`width` 为 Lorentzian HWHM |

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
| `mem_points` | int | MEM 计算点数 `N_MEM`（可选，默认 `N_original`） |
| `column` | int | 强度列索引（可选） |
| `params_json` | string | JSON 格式的 peak parameters（同 SFG Generator 格式，支持 Lorentzian/Voigt peak） |

响应：

```json
{
  "wavenumbers": [...],
  "original_wavenumbers": [...],
  "mem_input_intensity": [...],
  "mem_real": [...], "mem_imag": [...],
  "fitting_real": [...], "fitting_imag": [...],
  "n_original": 1000, "n_mem": 2500, "nn": 500
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
# N_original,2000
# N_MEM,5000
# original_frequency_range,2800 to 3800
# mem_frequency_range,2800 to 3800
# resampling_method,Interpolated from 2000 to 5000 points
# NN,1024
# error_phase_deg,0
# error_phase_rad,0
frequency_original,intensity_original,frequency_mem,intensity_mem_input,Re_mem,Im_mem
2800.0,0.0012,2800.0,0.0012,8.78283326e-03,-1.93211660e-02
```

当 `N_original` 与 `N_MEM` 不同时，普通 CSV 表中无法让每一行同时一一对应原始谱和 MEM 结果；导出文件会使用空值补齐较短数组。MEM vs Fitting 的完整比较导出还包含 `ideal_intensity_from_peak_parameters`、`Re_ideal_on_mem_grid`、`Im_ideal_on_mem_grid`、`Re_residual`、`Im_residual` 等列。

MEM vs Fitting 的 phase scan 默认只导出 NRMSE 相关列：

```
error_phase_deg,error_phase_rad,re_nrmse_full,im_nrmse_full
```

导出 metadata 会记录当前默认展示的 phase：

```
default_display_phase_deg
default_display_phase_rad
default_display_criterion
```

其中 `default_display_criterion` 可能为 `minimum_im_nrmse_full` 或 `minimum_im_nrmse_selected_window`。

启用 selected-window NRMSE 且窗口有效时，会额外导出：

```
window_start_cm-1,window_end_cm-1,window_points,re_nrmse_window,im_nrmse_window
```

导出文件的参数记录中会注明：

```
NRMSE = Normalized Root Mean Square Error
NRMSE 中文名称：归一化均方根误差
NRMSE normalization:
RMSE divided by RMS amplitude of the corresponding ideal spectrum
```

导出 metadata 还会记录完整光谱范围、用户设定的窗口范围、实际用于计算的有效窗口范围、full-range optimal phase 和 windowed optimal phase。

SFG Generator 导出包含总谱与各子峰分量。SFG Generator 和 MEM vs Fitting 的 peak parameter 导出文件会按当前 `Phase unit` 输出 `Phi`，并在文件注释中写明 `Phase unit: degrees` 或 `Phase unit: radians`。

## MEM 算法

基于 Yang 和 Huang（*J. Opt. Soc. Am. B*, 2000）提出、De Beer 和 Roke（EPFL, 2011）应用于 SFG 光谱学的最大熵法。

计算流程：逆 FFT（`np.fft.fft`，匹配 Mathematica `InverseFourier` 的负指数约定）→ Hermitian Toeplitz 自相关矩阵 → 线性求解 → MEDIAN 强度匹配缩放 → 输出 χ(ω)。误差相位通过 `χ_rot = χ · e^(iφ)` 校准。

## SFG 光谱公式

χ(ω) 由非共振项与多个 Lorentzian 或 Voigt 峰叠加。Lorentzian 峰使用：

```
χ(ω) = NR_Real + i·NR_Imag + Σ_q A_q · e^(i·φ_q) / (ω_q − ω − i·Γ_q)
```

| 参数 | 含义 |
|------|------|
| `NR_Real`, `NR_Imag` | 非共振复振幅 |
| `A_q` | 第 q 峰的振幅 |
| `ω_q` | 第 q 峰的中心波数 |
| `Γ_q` | 第 q 峰的 Lorentzian HWHM（半高半宽）；Lorentzian FWHM = `2Γ_q` |
| `Gaussian_FWHM_q` | Voigt 峰的 Gaussian FWHM；Lorentzian 峰忽略该值 |
| `φ_q` | 第 q 峰的相位（后端内部使用 rad；GUI 中 `Phi` 可由 `Phase unit` 选择 degrees 或 radians，默认 degrees） |

Voigt 峰通过 `scipy.special.wofz` 计算 Faddeeva function，并由此得到 complex Voigt response：`V_complex(ω) = i sqrt(pi) wofz(z) / (sigma sqrt(2))`。强度 = |χ(ω)|²，实部 = Re[χ]，虚部 = Im[χ]。

## 关联项目

| 项目 | 说明 |
|------|------|
| `../MEMPy/` | 原版 Tkinter 桌面 GUI（MEM 算法参考实现） |
| `../SFG generator/` | 原版 Tkinter SFG 生成器（UI 参考） |
| `../TestData/` | 标准测试数据集 |
