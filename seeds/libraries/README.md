# 库种子（git 备份）

本目录保存偏好库、文风库的可提交种子，便于数据丢失后恢复。

- `preferences.json` / `style-packs.json`：与用户目录中同名文件同形（`version: 1` + `entries`）。
- 运行时库仍在用户数据目录；本目录只作仓库备份与恢复源。

恢复（合并写入，不覆盖已有同 id 正文）：

```bash
npx tsx src/cli/restore-library-seeds.ts
```

导出当前用户库到本目录（覆盖种子文件，便于更新 git 备份）：

```bash
npx tsx src/cli/restore-library-seeds.ts --export
```
