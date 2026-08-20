-- 004：滞后分析支持负滞后（PRD 模块 H）。
-- lag = k>0 表示左序列领先右序列 k 期，k<0 对称；扫描范围 [-maxLag, +maxLag]。
-- 与 @platform/schemas resultRowSchema（lag ∈ [-60, 60]）对齐。
ALTER TABLE result_rows DROP CONSTRAINT IF EXISTS result_rows_lag_check;
ALTER TABLE result_rows ADD CONSTRAINT result_rows_lag_check CHECK (lag BETWEEN -60 AND 60);
