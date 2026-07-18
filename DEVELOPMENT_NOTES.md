# DEVELOPMENT_NOTES / 项目开发交接说明

更新时间：2026-07-15

本文用于给后续 Codex 新对话或人工开发者快速了解当前项目状态。本文只记录开发状态与约定，不改变任何计算逻辑。

## 1. 项目主要功能

本项目是一个基于 Web 的 SFG / MEM 光谱分析工具，前端使用 React + TypeScript + Ant Design + Plotly，后端使用 FastAPI + NumPy/SciPy/Pandas。

主要页面：

| 页面 | 主要用途 |
|------|----------|
| MEM Analyzer | 导入强度谱 `|chi|^2`，通过 MEM 重构复谱 `Re[chi]` 和 `Im[chi]`，并可导入外部 Re/Im reference 做对照和 NRMSE |
| SFG Generator | 根据 Lorentzian 或 Voigt peak parameters 生成 SFG intensity、Re 和 Im 光谱 |
| MEM vs Fitting | 将 MEM 重构结果与 peak-parameter ideal spectrum 或外部 Re/Im reference 对比，进行 error phase scan 和 NRMSE 优化 |
| Fitting Analysis | 输入 fitted peak parameters 与 ideal peak parameters，生成 fitted/ideal intensity、Re、Im；也可导入一个 reference spectrum 文件同时提供 Intensity/Re/Im 对照并计算 NRMSE |

后端核心文件：

| 文件 | 作用 |
|------|------|
| `backend/memnum.py` | MEM 核心算法，从强度谱重构复谱 |
| `backend/spectral_utils.py` | CSV 解析、强度列处理、MEM calculation points 重采样、phase rotation |
| `backend/spectrum_models.py` | Lorentzian 与 complex Voigt response |
| `backend/sfg_generator.py` | SFG 总谱与子峰计算 |
| `backend/main.py` | FastAPI API 路由 |

前端核心文件：

| 文件 | 作用 |
|------|------|
| `frontend/src/pages/MemAnalyzerPage.tsx` | MEM Analyzer 页面 |
| `frontend/src/pages/SfgGeneratorPage.tsx` | SFG Generator 页面 |
| `frontend/src/pages/MemVsFittingPage.tsx` | MEM vs Fitting 页面，含 error phase scan 与 NRMSE |
| `frontend/src/pages/FittingAnalysisPage.tsx` | Fitting Analysis 页面 |
| `frontend/src/utils/referenceSpectrum.ts` | 外部 reference spectrum 解析、列识别、插值对齐、NRMSE 相关工具 |
| `frontend/src/utils/phaseUnit.ts` | peak phase 单位显示、导入、导出转换 |
| `frontend/src/utils/sfgPeakParams.ts` | peak parameter 文件导入解析 |

## 2. 已完成的修改

### MEM calculation points

- 新增 `MEM calculation points / MEM 计算点数`，记为 `N_MEM`。
- 原始点数记为 `N_original`。
- 程序在进入 MEM 前生成独立的均匀 MEM 输入频率轴。
- `N_MEM = N_original` 且原始网格均匀时，直接使用原始网格。
- `N_MEM > N_original` 时，用一维插值生成更密 MEM 网格。
- `N_MEM < N_original` 时，对强度谱重采样到更稀疏 MEM 网格。
- 原始频率轴和原始强度谱保留，不被 MEM 输入网格覆盖。
- GUI/API 限制 `N_MEM <= 20000`。
- `NN` 必须满足 `2 <= NN < N_MEM`。

### Edge padding / 两端恒值扩展

- 新增 `Enable edge padding / 启用两端扩展`，可分别设置 left/right padding width，单位 `cm^-1`；GUI 复选框默认关闭，左右宽度输入框默认均为 `1000 cm^-1`，用户手动开启后才生效。
- 启用后，程序先用原始左端点强度和右端点强度对光谱两端做恒值延伸，再把 `N_MEM` 个点均匀分布到 padded MEM processing range 上。
- MEM 在 padded full range 上运行；原始光谱数组保留，不被覆盖。
- Residual、NRMSE、默认 optimal error phase 和 selected-window NRMSE 都只在 original evaluation range 内计算，padding 区域不参与评价。
- selected window 会裁剪到 original evaluation range，不能只落在 padding 区域。
- API/导出新增 `edge_padding_enabled`、`left_padding_width`、`right_padding_width`、`padded_frequency_range`、`evaluation_frequency_range`、`n_eval`、`evaluation_indices` 和 `mem_regions`；`mem_regions` 取值为 `left_padding`、`original`、`right_padding`。

### 外部 Re/Im reference 导入

- MEM Analyzer 支持导入外部 Re/Im reference。
- MEM vs Fitting 支持导入外部 Re/Im reference。
- 用户可以从 CSV/TXT 文件中选择 Wavenumber、Re、Im 列。
- 程序会根据列名自动预选，用户可手动改选。
- 外部 reference 会插值到 MEM 输出频率轴，用于叠图、residual 和 NRMSE。
- 外部 reference 频率范围必须覆盖当前 MEM 网格，否则不用于 NRMSE。

### NRMSE error-phase scan

- MEM vs Fitting 中新增并保留 NRMSE 作为当前 GUI 推荐和默认误差指标。
- 计算 `Re-NRMSE` 与 `Im-NRMSE`。
- NRMSE 定义为 residual RMSE 除以对应 reference 谱分量 RMS。
- NRMSE 是无量纲数值，越小表示 MEM 与 reference 越接近。
- 若 reference RMS 接近 0，使用 epsilon 防止除以 0、NaN 或 Inf。
- phase scan 默认支持 `0°` 到 `360°` 扫描。
- 默认展示 minimum Im-NRMSE 对应的 error phase。
- 支持 selected spectral window NRMSE，即只在用户指定波数窗口内计算局部 NRMSE。

### GUI 中隐藏旧误差指标

- GUI 中不再把 absolute residual sum、MAE、residual standard deviation 作为主要指标展示。
- phase scan CSV 默认只导出 NRMSE 相关列。
- 旧指标如仍在内部函数或历史代码中存在，不作为默认优化或 GUI 展示依据。

### Peak parameters 命名统一

- 面向用户的 `Fitting parameters` 已统一改为 `Peak parameters`。
- `MEM vs Fitting` 页面名称保留，因为它表达的是 MEM 与 fitting/ideal model 的比较。
- peak parameters 指 Lorentzian/Voigt 峰参数，可来自手动输入、文件导入或拟合结果。
- 若特指拟合得到的参数，文档中使用 `fitted peak parameters`。

### Phase unit 统一

- `SFG Generator`、`MEM vs Fitting` 和 `Fitting Analysis` 使用统一 `Phase unit` 控件。
- 可选值：
  - `Degrees (°)`
  - `Radians (rad)`
- 默认值为 `Degrees (°)`。
- GUI 中切换单位时，当前面板已有 Phi 数值会自动换算，物理相位不变。
- 导入 peak parameter 文件时，不自动猜测单位，始终按当前 GUI 选择的 `Phase unit` 解释 Phi。
- 导出 peak parameter 文件时，Phi 按当前 GUI 选择的 `Phase unit` 输出，并在文件注释中写明相位单位。

### Lorentzian 和 Voigt 说明

- Lorentzian 保持原有复响应定义：

```text
chi_q(omega) = A_q exp(i phi_q) / (omega_q - omega - i Gamma_q)
```

- `Gamma` / `width` / `Lorentzian HWHM` 表示 Lorentzian 半高半宽 HWHM，不是 FWHM。
- Lorentzian FWHM = `2 * Gamma`。
- Voigt 使用 `backend/spectrum_models.py` 中的 `complex_voigt()`。
- `complex_voigt()` 调用 `scipy.special.wofz`，即 Faddeeva function。
- GUI 和新 peak parameter 文件中的 Voigt Gaussian 输入统一使用 `Gaussian_HWHM`（半宽），旧字段 `Gaussian_FWHM` 仍可导入并自动除以 2 转成 HWHM。
- 前端/API 会把 `Gaussian_HWHM` 转成等价 `Gaussian_FWHM` 后送入现有 Voigt 计算路径，核心 complex Voigt 公式不变。
- Voigt peak 面板会自动逐行显示非重复且已定义的派生宽度，包括 Lorentzian FWHM、Gaussian FWHM、Gaussian standard deviation (sigma)、近似 Voigt HWHM/FWHM 和 Voigt equivalent Gaussian sigma：

```text
Gaussian_FWHM = 2 * Gaussian_HWHM
sigma = Gaussian_HWHM / sqrt(2 ln 2)
Voigt_FWHM ≈ 0.5346 * Lorentzian_FWHM + sqrt(0.2166 * Lorentzian_FWHM^2 + Gaussian_FWHM^2)
```

- Voigt 宽度显示使用 Olivero-Longbothum 近似，只是 GUI 读数，不改变 complex Voigt response 的计算定义。
- Gaussian HWHM 输入框后不再保留单独计算按钮；派生值由面板自动刷新。
- Lorentzian 的严格标准差不存在；含非零 Lorentzian 分量的 Voigt 严格标准差也不存在。GUI 不显示这些 undefined 项，只显示从近似 Voigt FWHM 折算的 equivalent Gaussian sigma 作为宽度量级参考。
- 程序实现的是 complex Voigt response，不是对最终强度 `|chi|^2` 做卷积。

### Fitting Analysis 页面

- 新增独立页面 `Fitting Analysis`。
- 页面包含两组 peak parameters：
  - `Fitted Peak Parameters`
  - `Ideal Peak Parameters`
- fitted peak parameters 中不显示 Label 输入。
- Ideal intensity、Re、Im 可以由 `Ideal Peak Parameters` 生成。
- 也可以导入一个 reference spectrum 文件，同时选择：
  - Wavenumber
  - Intensity
  - Ideal Re
  - Ideal Im
- 导入 reference 后，外部 Intensity/Re/Im 优先用于对照和 NRMSE；未导入时回退到 ideal peak parameters 生成的谱。
- 结果区显示 Re-NRMSE、Im-NRMSE、Complex NRMSE、Intensity-NRMSE。

### CSV 导出

- MEM Analyzer 导出保留原始谱、MEM 输入谱、MEM 输出谱。
- MEM vs Fitting 导出包含 reference 来源、NRMSE phase scan、selected-window NRMSE 等 metadata。
- Fitting Analysis 导出包含 fitted Re/Im/intensity、reference Re/Im/intensity、residual 和 NRMSE metadata。

### CSV 导入列清洗

- MEM 强度谱 CSV 导入时，只要求第一列 Wavenumber 和用户当前选择的强度列含有至少 3 行有效数值。
- 其他无关列可以包含文本、备注或空值；这些列不会再触发整行 `dropna`，避免多列 CSV 被误删到少于 3 个有效点。
- 无表头 CSV 会按 `header=None` 重新读取，保留第一行数据。
- SFG Generator 的 spectrum CSV 导出会 quote 带逗号的表头；MEM 导入兼容旧版本未 quote 的 Voigt 子峰表头。

### SFG intensity 数量级核查

- 已系统核查 SFG Generator 的 intensity 生成链路：Lorentzian 复响应、nonresonant contribution、phase 单位、复 susceptibility `chi(omega)` 构建、`intensity = |chi|^2`、GUI 绘图、CSV 导出、MEM vs Fitting 和 Fitting Analysis 的复用路径。
- 当前代码未发现 intensity 少一个数量级的问题。
- 后端主定义保持：

```text
chi(omega) = chi_NR + sum_q A_q exp(i phi_q) / (omega_q - omega - i Gamma_q)
Intensity(omega) = |chi(omega)|^2
```

- `backend/spectrum_models.py` 中 `compute_intensity(chi)` 使用 `np.abs(chi) ** 2`，不是 `abs(chi)`。
- SFG Generator 的 GUI 图线、绘图数据和 CSV 导出直接使用后端返回的同一组 `intensity` 数组；没有 max normalization、除以 10/100、display scaling 或额外 scale factor。
- `MEM vs Fitting` 通过 `/api/mem/compare` 调用同一个 `compute_sfg_spectrum()` 生成 `fitting_intensity`。
- `Fitting Analysis` 通过 `/api/sfg/generate` 分别生成 fitted 与 ideal spectrum，复用同一套 SFG 生成逻辑。
- 已新增后端回归测试 `backend/tests/test_sfg_generator.py`，覆盖：
  - 单峰解析值：`A=1, omega0=3000, Gamma=10, phi=0, chi_NR=0, omega=3000` 时 `Intensity=0.01`；
  - nonresonant 情况：`chi_NR=1+0i` 时 `Intensity=1.01`；
  - `90°` 转成 radians 与 `1.57079632679 rad` 的输出等价。
- README 已补充说明：SFG Generator 不对 `chi(omega)` 或 `Intensity(omega)` 做归一化或显示缩放。

### Frontend bundle 与小屏布局

- 前端页面已改为 React lazy loading，四个主页面按需加载，避免首屏一次性加载全部页面代码。
- Plotly 不再在图表组件或页面顶层静态导入；统一通过 `frontend/src/utils/plotlyLoader.ts` 按需加载 `plotly.js/lib/core`。
- 由于 Plotly core 已内置 scatter trace，当前图表只加载 Plotly core，不再加载完整 `plotly.min.js`。
- `frontend/vite.config.ts` 已移除对完整 `plotly.js` 的 `optimizeDeps.include`，并把 `chunkSizeWarningLimit` 设置为 `1200`，对应当前按需 Plotly core chunk 的体积预算。
- `npm.cmd run build` 当前已不再输出 Plotly chunk size warning。
- `SFG Generator` 参数卡片在桌面端仍保持固定高度滚动；在 `lg` 以下屏幕自动恢复内容高度，减少小屏幕参数面板拥挤和滚动套滚动问题。

## 3. 重要约定

请后续开发务必保持以下约定，除非用户明确要求修改物理定义。

### Peak phase

- GUI 默认使用 degrees。
- 后端内部始终使用 radians。
- peak parameter 文件导入时，Phi 数值按当前 GUI `Phase unit` 解释。
- 不要根据数值大小自动判断 degrees/radians。

### Error phase

- GUI 中 error phase 输入、phase scan start/end/step 使用 degrees。
- 后端 `/api/mem/phase` 和内部旋转使用 radians。
- 前端负责把 degree 转换为 radian：

```text
phi_rad = phi_deg * pi / 180
```

### NRMSE

- NRMSE 是当前 GUI 唯一主要误差指标。
- 不要在 GUI 中把 NRMSE 称为 standard deviation、STD 或 standard error。
- 中文名称固定为：归一化均方根误差。
- 默认展示 minimum Im-NRMSE 对应的 phase。
- 若启用 selected spectral window NRMSE，则默认展示 selected-window minimum Im-NRMSE 对应的 phase；否则展示 full-range minimum Im-NRMSE 对应的 phase。

### Peak parameters 命名

- 用户可见文案中使用 `Peak parameters`。
- 不再把普通 Lorentzian/Voigt 峰参数称为 `Fitting parameters`。
- 内部变量或函数名如果已经存在 `fitting`，且只是内部实现，可以暂时保留，避免无意义大重命名。

### MEM 与 SFG 物理定义

- 不要随意修改：
  - Lorentzian 复响应定义；
  - non-resonant term 定义；
  - MEM 主算法；
  - 自相关定义；
  - Toeplitz 线性求解；
  - minimum-phase / MEM reconstruction 约定；
  - error phase rotation 约定；
  - Voigt 的 complex response 实现。

## 4. 当前还需要继续处理的问题

当前没有已知必须立即修复的计算逻辑阻塞，但后续仍建议关注：

1. GUI 视觉和布局仍可继续打磨；SFG Generator 参数面板的小屏幕拥挤问题已做一轮响应式处理，但 MEM Analyzer、MEM vs Fitting 和 Fitting Analysis 仍建议后续用真实小屏设备手动复核。
2. Plotly 已改为按需加载 core bundle，`npm run build` 当前不再提示 chunk size warning；后续若新增非 scatter 图形类型，需要确认是否必须注册额外 Plotly trace，并重新检查构建体积。
3. 当前已有少量后端回归测试覆盖 SFG intensity 解析值；前端仍主要依赖 `npm run build`、`npm run lint` 和人工 GUI 操作，还没有系统化的前端自动测试套件。本轮尝试使用内置浏览器打开本地生产构建时被浏览器插件以 `ERR_BLOCKED_BY_CLIENT` 拦截，未完成可视化浏览器验证。
4. 若运行时出现 `Request failed with status code 502`，通常表示前端 dev server 无法访问后端，需要确认 `backend/main.py` 已启动且 `/api/health` 正常。
5. Git 在某些 Windows 用户环境下可能提示 `dubious ownership`，这是 Git 安全检查，不影响程序运行；需要 Git 操作时可临时使用 `git -c safe.directory=...`，不要随意修改用户全局配置，除非用户明确同意。
6. 外部 reference 文件导入已支持灵活列选择，但仍建议用真实实验文件做更多手动验证，确认不同表头、分隔符和列顺序都符合预期。
7. MEM 的 `NN`、`N_MEM`、插值网格和 phase scan 结果可能对数值稳定性有影响；比较不同设置时应使用 NRMSE 和 residual，而不是只看曲线平滑程度。
8. 如果后续再次观察到 SFG Generator intensity 与旧版本或手算结果差约一个数量级，优先检查外部参考谱、旧版本定义、输入参数单位和 amplitude/linewidth 含义差异；不要直接乘以 10，也不要引入 arbitrary scale factor。
9. 如果再次出现 `At least 3 original points are required for MEM calculation`，优先检查当前选择的强度列在 CSV 清洗后是否确实有至少 3 个数值点。SFG Generator 新导出的 Voigt spectrum CSV 已对带逗号表头做标准 quoting，MEM 导入也已兼容旧版未 quote 的 Voigt 表头；如果仍报错，通常是选到了非强度列、文本列，或文件中有效波数/强度行不足。
10. `npm.cmd run build` 与 `npm.cmd run lint` 并行运行时偶发 Vite/Rolldown `index.html` emitted asset 路径错误；单独顺序运行 build/lint 可通过。后续如要彻底解决，需要检查 Vite/Rolldown 在 Windows 路径和并发构建下的行为。

## 5. 运行程序和测试的方法

### 首次安装前端依赖

```bash
cd frontend
npm install
```

### 开发模式手动启动

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

默认访问：

```text
http://localhost:3000
```

后端健康检查：

```text
http://localhost:8000/api/health
```

### 使用 run.bat

双击根目录 `run.bat`：

- 选择 Dev Mode：分别启动后端和前端。
- 选择 Prod Mode：先构建前端，再由后端托管静态文件。

### 构建与 lint

```bash
cd frontend
npm run build
npm run lint
```

如果在 Windows PowerShell 中遇到 `npm.ps1` 执行策略限制，可在同一目录改用：

```bash
npm.cmd run build
npm.cmd run lint
```

当前建议顺序运行 build 和 lint，避免并行执行；并行执行曾偶发 Vite/Rolldown `index.html` 路径错误。

### 后端回归测试

当前已有后端回归测试覆盖 edge padding、CSV 导入清洗、SFG Generator intensity 解析值、nonresonant contribution、phase unit 等价性，以及 Voigt Gaussian HWHM/FWHM 等价性：

```bash
python -m unittest discover -s backend\tests
```

在 Windows PowerShell 中，如需避免测试运行时生成或改动 `__pycache__`，可临时使用：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
python -m unittest discover -s backend\tests
```

目前常用验证标准：

- `npm run build` 通过；
- `npm run lint` 通过；
- `python -m unittest discover -s backend\tests` 通过；
- 手动打开四个页面；
- MEM Analyzer 能导入强度谱并运行 MEM；
- SFG Generator 能生成 intensity/Re/Im；
- MEM vs Fitting 能运行 MEM & Compare、error phase scan 和 NRMSE；
- Fitting Analysis 能用 fitted/ideal peak parameters 生成结果，也能导入一个 reference spectrum 文件选择 Intensity/Re/Im 列。

## 6. 后续 Codex 新对话继续开发时注意事项

1. 修改前先阅读 `README.md` 和本文件，确认当前术语和物理约定。
2. 如果用户要求新增功能，优先做小范围增量修改，不要重写整个项目。
3. 不要为了整理代码而大规模重命名内部变量、函数或文件，除非用户明确要求。
4. 不要修改 MEM、Lorentzian、Voigt、error phase、NRMSE 的物理定义，除非先明确说明原因和影响，并得到用户确认。
5. 用户更关注 GUI 是否直观、术语是否准确、导入导出是否清楚；文案修改要同步 README。
6. 所有用户可见的 `Fitting parameters` 应继续改为或保持为 `Peak parameters`。
7. 相位单位相关功能必须保持：
   - GUI 显示单位可选；
   - 后端内部 radians；
   - 导入导出按 GUI 当前单位；
   - 切换单位时数值自动换算、物理相位不变。
8. 若新增误差评估，不能替代或混淆当前默认 NRMSE；GUI 主指标仍应保持 NRMSE。
9. 对外部 reference 做比较前，必须保证频率轴、数组长度和数组顺序严格对齐，不允许隐式截断或广播。
10. 任何导出 CSV 的列名或 metadata 变化，都应同步 README 和本文件。
11. SFG Generator 的 intensity 当前已确认按 `|chi|^2` 输出且无显示缩放；若后续怀疑数量级问题，先用 `backend/tests/test_sfg_generator.py` 的解析用例复核，不要直接改物理公式或乘常数。
12. 当前工作区可能包含尚未提交的 README 和 `backend/tests/test_sfg_generator.py` 变更；继续开发前先看 `git status`，不要覆盖已有修改。
13. 运行测试时优先使用：

```bash
cd frontend
npm run build
npm run lint
```

14. 如需检查后端接口，可先启动后端并访问 `/api/health`，再进行 GUI 或 API 测试。
15. 前端验证命令建议顺序运行，不要把 `npm.cmd run build` 和 `npm.cmd run lint` 并行跑，除非正在专门排查 Vite/Rolldown 并发构建问题。
