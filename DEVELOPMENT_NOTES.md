# DEVELOPMENT_NOTES / 当前开发交接说明

更新时间：2026-08-16

本文用于给后续 Codex 新对话或人工开发者快速了解当前项目状态。本文只记录开发状态、约定、运行方式和待办事项；本次更新不修改任何计算逻辑。

## 1. 项目主要功能

本项目是一个基于 Web 的 SFG / MEM 光谱分析工具。

技术栈：

- 后端：FastAPI、NumPy、SciPy、Pandas。
- 前端：React、TypeScript、Ant Design、Plotly、Vite。

当前主要页面：

| 页面 | 主要用途 |
| --- | --- |
| MEM Analyzer | 导入实验强度谱 `|chi|^2`，通过 MEM 重构复谱 `Re[chi]` 和 `Im[chi]`；支持 phase 调节、edge padding、外部 Re/Im reference、CSV 导出。 |
| SFG Generator | 根据 Lorentzian / Voigt peak parameters 生成 SFG intensity、Re、Im 和子峰分量。 |
| MEM vs Fitting | 将 MEM 重构结果与 peak-parameter ideal spectrum 或外部 Re/Im reference 对比；支持 error phase scan、NRMSE、selected spectral window NRMSE。 |
| Fitting Analysis | 比较 fitted peak parameters 与 ideal peak parameters 生成的谱；也可导入包含 Intensity/Re/Im 的 reference spectrum 并计算 NRMSE。 |
| Complex Voigt Response & Minimum Phase Analyzer | 生成 complex Voigt susceptibility，在实频轴显示 `Re[chi]`、`Im[chi]`、`|chi|^2`，并在复频平面扫描/搜索零点，用于数值探索 minimum-phase 条件。 |

主要后端文件：

| 文件 | 作用 |
| --- | --- |
| `backend/main.py` | FastAPI API 路由入口。 |
| `backend/memnum.py` | MEM 核心算法。 |
| `backend/spectral_utils.py` | CSV 解析、强度列提取、MEM 网格重采样、edge padding、phase rotation。 |
| `backend/spectrum_models.py` | Lorentzian 与 complex Voigt response 的 SFG 模型。 |
| `backend/sfg_generator.py` | SFG 总谱和子峰分量计算。 |
| `backend/complex_voigt_analyzer.py` | Complex Voigt analyzer 的复平面计算、Faddeeva Voigt、零点候选和 root finding。 |

主要前端文件：

| 文件 | 作用 |
| --- | --- |
| `frontend/src/App.tsx` | 顶部 tab 和页面入口。 |
| `frontend/src/pages/MemAnalyzerPage.tsx` | MEM Analyzer 页面。 |
| `frontend/src/pages/SfgGeneratorPage.tsx` | SFG Generator 页面。 |
| `frontend/src/pages/MemVsFittingPage.tsx` | MEM vs Fitting 页面。 |
| `frontend/src/pages/FittingAnalysisPage.tsx` | Fitting Analysis 页面。 |
| `frontend/src/pages/ComplexVoigtAnalyzerPage.tsx` | Complex Voigt Response & Minimum Phase Analyzer 页面。 |
| `frontend/src/api/mem.ts` | 前端 API 调用。 |
| `frontend/src/types/mem.ts` | 共享 TypeScript 类型。 |
| `frontend/src/utils/phaseUnit.ts` | peak phase 单位转换、参数文件解析基础工具。 |
| `frontend/src/utils/sfgPeakParams.ts` | SFG peak parameter 文件导入解析。 |
| `frontend/src/utils/referenceSpectrum.ts` | reference spectrum 解析、对齐、NRMSE 工具。 |

## 2. 已完成的修改

### MEM 与 edge padding

- 已支持 `MEM calculation points`，即独立的 `N_MEM`。
- 保留 `N_original`，原始实验谱不会被 MEM 输入网格覆盖。
- `NN` 必须满足 `2 <= NN < N_MEM`。
- 已支持 edge padding，两端用原始端点强度做恒值扩展。
- MEM 在 padded full range 上运行；residual、NRMSE、默认 phase 选择只在 original evaluation range 内计算。
- 导出和 API metadata 中包含 `edge_padding_enabled`、`left_padding_width`、`right_padding_width`、`padded_frequency_range`、`evaluation_frequency_range`、`n_eval`、`evaluation_indices`、`mem_regions` 等信息。

### CSV 导入与 reference spectrum

- MEM 强度谱 CSV 导入时，只要求 wavenumber 列和当前选择的强度列有足够数值行；其它备注列、空列或文本列不再导致整行被丢弃。
- 支持无表头 CSV。
- 支持 SFG Generator 导出中带逗号的 Voigt 子峰表头。
- MEM Analyzer 支持外部 Re/Im reference。
- MEM vs Fitting 支持外部 Re/Im reference。
- Fitting Analysis 支持导入一个同时包含 Wavenumber、Intensity、Ideal Re、Ideal Im 的 reference spectrum。
- reference 会先对齐到当前计算网格，再参与 residual 和 NRMSE。

### SFG Generator 与 Fitting Analysis

- SFG Generator 支持 Lorentzian 和 Voigt peak。
- Lorentzian 宽度使用 HWHM。
- SFG Generator 的强度定义保持：

```text
Intensity(omega) = |chi(omega)|^2
```

- Fitting Analysis 已作为独立页面存在，可比较 fitted peak parameters、ideal peak parameters 和外部 reference。
- Fitting Analysis 结果区显示 Re-NRMSE、Im-NRMSE、Complex NRMSE、Intensity-NRMSE。

### NRMSE 与 error phase scan

- MEM vs Fitting 中当前唯一 GUI 误差指标是 NRMSE。
- 当前不再把 absolute residual sum、MAE、residual standard deviation 作为 GUI 主误差指标。
- NRMSE 定义为 residual RMSE 除以对应 reference 谱分量 RMS。
- 若 reference RMS 接近 0，使用 epsilon 防止除以 0、NaN 或 Inf。
- error phase scan 默认以 degree 设置起点、终点和步长。
- 默认展示 minimum Im-NRMSE 对应 phase。
- 如果启用 selected spectral window NRMSE 且窗口有效，则默认展示 selected-window minimum Im-NRMSE 对应 phase；否则使用 full-range minimum Im-NRMSE。

### Peak parameters 命名

- 用户可见显示名中，`Fitting parameters` 已改为或应保持为 `Peak parameters`。
- 页面标题 `MEM vs Fitting` 可以保留，因为它描述的是 MEM 与 fitting/ideal model 的比较。
- 如果确实特指拟合得到的参数，使用 `fitted peak parameters`。
- 内部变量名中已有的 `fitting` 可以暂时保留，避免无意义大重命名。

### Phase unit 统一

- SFG Generator、MEM vs Fitting、Fitting Analysis 的 peak phase GUI 默认使用 degrees。
- 后端 peak phase 计算使用 radians。
- peak parameter 文件导入时，不自动猜测单位；按当前 GUI phase unit 解释。
- peak parameter 文件导出时，按当前 GUI phase unit 输出。
- error phase GUI 使用 degrees。
- error phase 后端和内部旋转使用 radians。

### Complex Voigt Response & Minimum Phase Analyzer

- 已新增独立模块和页面，不改现有 MEM/SFG 计算逻辑。
- 后端新增 `POST /api/complex-voigt/analyze`。
- 支持非共振背景：

```text
chi_NR = chi_NR_real + i chi_NR_imag
```

- 支持多个 oscillator，每个 oscillator 包含：
  - profile type：Lorentzian 或 Voigt；
  - amplitude；
  - center frequency；
  - Lorentzian HWHM；
  - Gaussian HWHM；
  - phase，GUI 中用 degree。
- Gaussian 由 GUI 输入 HWHM，后端内部转换为 sigma：

```text
sigma = Gaussian_HWHM / sqrt(2 ln 2)
```

- Complex Voigt 使用 `scipy.special.wofz`。
- 复响应保持与现有项目一致的符号约定：

```text
L(z) = 1 / (omega0 - z - i Gamma)
     = -1 / (z - omega0 + i Gamma)
```

- Lorentzian pole 位于：

```text
z = omega0 - i Gamma
```

- Complex Voigt 的 Faddeeva argument 使用：

```text
(z - omega0 + i Gamma) / (sigma * sqrt(2))
```

- 页面显示：
  - 实频轴 `Re[chi(omega)]`；
  - 实频轴 `Im[chi(omega)]`；
  - intensity `|chi(omega)|^2`；
  - complex-plane heatmap；
  - detected zeros；
  - `Im(z)=0` 分界线；
  - Nyquist plot。
- 零点分类：
  - `y > 0`：Upper half-plane zero detected；
  - `y < 0`：Lower half-plane zero；
  - `y = 0` 附近：Real-axis zero。
- 页面包含 minimum phase 解释面板，明确说明这是 finite-region numerical exploration，不是全局数学证明。
- 已加入默认示例：
  - Single Lorentzian peak；
  - Single Voigt peak；
  - Two overlapping Voigt peaks with opposite phase；
  - Water OH-like multi-peak spectrum；
  - User-defined arbitrary peaks。
- 已加入自定义参数导入功能，按钮为 `Import custom parameters`。
- 自定义参数导入支持 `.txt` / `.csv`，沿用 key=value 风格，例如 `XMin`、`XMax`、`NR_Real`、`A1`、`Omega1`、`Lorentzian_HWHM1`、`Gaussian_HWHM1`、`Phi1`。
- 导入时也兼容部分别名：
  - `Gamma1` 作为 Lorentzian HWHM；
  - `Gaussian_FWHM1` 自动除以 2 转成 Gaussian HWHM；
  - `Gaussian_Sigma1` 按 `HWHM = sigma * sqrt(2 ln 2)` 转换。
- 页面支持导出：
  - oscillator parameters；
  - `chi(omega)`；
  - `Re[chi]`；
  - `Im[chi]`；
  - intensity；
  - zero positions；
  - 重要符号约定 metadata。

### 测试和验证

- 前端 `npm.cmd run lint` 已通过。
- 前端 `npm.cmd run build` 已通过。
- build 仍有 Plotly chunk size warning，这是已知打包体积问题，不是构建失败。
- 后端曾做过 Complex Voigt smoke test，验证：
  - Gaussian HWHM 到 sigma；
  - Gaussian HWHM 为 0 时回到 Lorentzian；
  - 一个解析下半平面零点可被找到。
- 当前环境曾出现 `python -m pytest backend\tests` 无法运行，原因是当前 Python 环境没有安装 pytest。

## 3. 重要约定

后续开发务必保持以下约定，除非用户明确要求修改物理定义。

### Peak phase

- Peak phase GUI 默认使用 degrees。
- 后端 peak phase 使用 radians。
- 前端负责将 degree 转为 radian。
- peak parameter 文件导入时，Phi 按当前 GUI phase unit 解释。
- 不要根据数值大小自动猜测 degrees/radians。

### Error phase

- Error phase GUI 使用 degrees。
- Error phase 后端和内部旋转使用 radians。
- 前端负责转换：

```text
phi_rad = phi_deg * pi / 180
```

- `/api/mem/phase` 中的 `phase_angle` 含义保持为 radians。

### NRMSE

- NRMSE 是当前唯一 GUI 误差指标。
- 中文名称：归一化均方根误差。
- 不要在 GUI 中把 NRMSE 称为 standard deviation、STD 或 standard error。
- 默认展示 minimum Im-NRMSE 对应 phase。
- selected spectral window NRMSE 只影响窗口有效时的默认展示 phase 和局部指标，不改变 MEM 计算本身。

### Peak parameters

- 用户可见显示名使用 `Peak parameters`。
- `Fitting parameters` 显示名已改为 `Peak parameters`，后续不要改回去。
- 内部变量名不必为了文案统一而大规模重命名。

### 物理和数值定义

- 不要随意修改 MEM 主算法。
- 不要随意修改 Lorentzian 符号约定。
- 不要随意修改 Voigt 符号约定。
- 不要引入 arbitrary intensity scale factor。
- SFG intensity 保持 `|chi|^2`。
- Complex Voigt analyzer 是数值探索工具，不应在 UI 中宣称可严格证明全局 minimum phase。

## 4. 当前还需要继续处理的问题

1. 如果用户打开新模块时看到 `Method Not Allowed`，优先检查是否有旧后端进程占用 8000。旧后端可能没有 `/api/complex-voigt/analyze`，导致新前端调用 API 时返回 405。
2. Windows 上可能残留 `node.exe` 或 `python.exe` 后台进程，占用 3000、3001、8000、8001。重新运行 `run.bat` 前最好确认旧窗口和旧进程已关闭。
3. 生产模式下后端会托管 `frontend/dist`。如果改了前端但没有重新 build，8000 上可能仍显示旧页面。
4. Plotly 打包体积仍然很大，`npm run build` 会提示 chunk size warning。后续可考虑页面懒加载或拆分 Plotly。
5. 前端目前主要靠 lint、build 和人工 GUI 检查，没有系统化 UI 自动测试。
6. 后端测试文件混合了 unittest 风格和 pytest 风格。若要一次跑全量测试，推荐安装 pytest 后使用 `python -m pytest backend\tests`。
7. 当前某些环境中 pytest 未安装，需要先在实际使用的 Python 环境安装依赖。
8. 仓库中存在已跟踪的 `backend/__pycache__` 文件，运行 Python 后容易出现无关 `.pyc` 差异。不要把这些缓存差异误认为源码修改。
9. Git 可能提示 `dubious ownership`。需要读状态时可临时使用 `git -c safe.directory=C:/Users/XIHUjjh/Documents/GitHub/SFGMEMweb ...`，不要未经用户同意修改全局 Git 配置。
10. Complex Voigt zero search 是有限网格和有限初值的数值搜索，可能漏掉扫描区域外或候选点不足导致的零点。UI 文案应继续保持谨慎。
11. 自定义参数导入已支持常用字段，但真实实验/拟合软件导出的格式可能更多，后续可按用户样例继续扩展字段别名。
12. README 可能需要同步补充 Complex Voigt 新模块的说明和导入格式。

## 5. 运行程序的方法

### 使用 run.bat

在项目根目录双击：

```text
run.bat
```

选择：

```text
1
```

表示 Dev Mode，会分别启动：

- 后端：`http://localhost:8000`
- 前端：`http://localhost:3000`

如果 3000 被占用，Vite 可能自动切换到 3001、3002 等端口。应以 MEM Frontend 窗口中显示的 `Local:` 地址为准。

选择：

```text
2
```

表示 Prod Mode，会构建前端并由后端在 8000 托管页面。

### 手动开发模式

后端：

```bash
cd backend
python main.py
```

前端：

```bash
cd frontend
npm run dev
```

如果 PowerShell 拦截 `npm.ps1`，使用：

```bash
npm.cmd run dev
```

### 健康检查

后端健康检查：

```text
http://localhost:8000/api/health
```

正常返回：

```json
{"status":"ok"}
```

注意：`/api/complex-voigt/analyze` 是 POST API，不能直接在浏览器地址栏打开。直接 GET 访问 API 地址出现 405 或 404，不一定代表前端坏了。

## 6. 测试方法

### 前端 lint

```bash
cd frontend
npm.cmd run lint
```

### 前端 build

```bash
cd frontend
npm.cmd run build
```

如果 build 成功但提示 Plotly chunk size warning，可以暂时接受。

### 后端测试

推荐安装 pytest 后运行：

```bash
python -m pytest backend\tests
```

如果只想运行现有 unittest 风格测试：

```bash
python -m unittest discover -s backend\tests
```

注意：`test_complex_voigt_analyzer.py` 当前是 pytest 风格函数测试，`unittest discover` 不会完整覆盖它。

### 手动 GUI 验证清单

- MEM Analyzer 可上传强度谱并运行 MEM。
- SFG Generator 可生成 intensity/Re/Im。
- MEM vs Fitting 可运行 MEM & Compare，并显示 NRMSE phase scan。
- Fitting Analysis 可生成 fitted/ideal spectrum，并可导入 reference spectrum。
- Complex Voigt Response & Minimum Phase Analyzer 可运行默认示例，显示 heatmap、Nyquist plot 和零点表。
- Complex Voigt 页面可导入 custom parameters 文件。
- CSV 导出文件包含必要 metadata。

## 7. 后续 Codex 新对话继续开发时注意事项

1. 开始前先阅读 `README.md` 和本文件。
2. 开始前先看 `git status`，确认当前已有未提交修改；不要覆盖用户或前一个 Codex 留下的改动。
3. 除非用户明确要求，优先做小范围增量修改。
4. 不要为了整理代码而重写 MEM、SFG、Voigt 或 NRMSE 逻辑。
5. 不要修改计算逻辑来修正文案问题；文案问题只改 UI 文案或文档。
6. 用户明确要求“只写交接文件”时，只修改 `DEVELOPMENT_NOTES.md`。
7. 如果要新增页面，优先新增独立文件，只在 `App.tsx`、types 和 API 层做必要接入。
8. 用户可见术语继续保持：
   - `Peak parameters`；
   - `NRMSE`；
   - `Error phase`；
   - `Lorentzian HWHM`；
   - Complex Voigt 页面中的 `Gaussian HWHM`。
9. Peak phase GUI 默认 degrees，后端 radians。
10. Error phase GUI degrees，后端 radians。
11. 默认展示 minimum Im-NRMSE 对应 phase。
12. NRMSE 是当前唯一 GUI 误差指标。
13. 如果用户报告 405，先检查旧后端、旧 `dist`、端口占用和是否直接打开 POST API。
14. 运行 Python 后若出现 `.pyc` 差异，不要把它们作为功能修改提交。
15. 每次实际代码修改后，至少运行：

```bash
cd frontend
npm.cmd run lint
npm.cmd run build
```

16. 涉及后端计算时，补充或运行后端测试；若 pytest 不可用，明确告诉用户测试未能运行的原因。
