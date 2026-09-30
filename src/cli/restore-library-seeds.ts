/**
 * 从仓库 seeds/libraries 恢复偏好库/文风库，或导出当前库到种子目录。
 *
 *   npx tsx src/cli/restore-library-seeds.ts
 *   npx tsx src/cli/restore-library-seeds.ts --export
 */
import {
  exportLibrarySeedsToRepo,
  restoreLibrarySeedsFromRepo,
} from "../libraries/seed-backup.js";

const exportMode = process.argv.includes("--export");

if (exportMode) {
  const result = exportLibrarySeedsToRepo();
  console.log(
    `已导出种子：preferences=${result.preferences}  style-packs=${result.stylePacks}`,
  );
} else {
  const result = restoreLibrarySeedsFromRepo();
  console.log(
    `已合并恢复：preferences +${result.preferencesAdded}  style-packs +${result.stylePacksAdded}`,
  );
}
