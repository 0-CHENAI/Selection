# OfficeCLI 升级差异报告

- 旧版本：1.0.157 (f950ee40)
- 新版本：1.0.160 (f950ee40)
- 上游 tag commit：c56512c8c7b76fe284f09940e4cd492470099d3e
- 未分类命令：无
- 过期分类：无

## 命令

```json
{
  "added": [],
  "removed": [],
  "flagChanges": [
    {
      "command": "batch",
      "added": [
        "--compact"
      ],
      "removed": []
    },
    {
      "command": "help",
      "added": [
        "--compact"
      ],
      "removed": []
    }
  ]
}
```

## Guides 与资源

```json
[
  {
    "name": "word",
    "headings": {
      "added": [],
      "removed": []
    },
    "assets": {
      "added": [],
      "removed": [],
      "changed": [
        {
          "path": "SKILL.md",
          "beforeSha256": "4dbeacba4bd107417fc31204ce22e91b37e5747d0541090d75ebb0ed14e02559",
          "afterSha256": "a5a294fc04ec9983d766cec70887d563f3337e13a8a25db37d5a522bd37fc298"
        }
      ]
    }
  }
]
```

## 平台资产

```json
{
  "added": [],
  "removed": [],
  "changed": [
    {
      "key": "darwin-arm64",
      "before": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-mac-arm64",
        "sha256": "0dae0990a9cc29688a5d54469f984c34e5b15ab6bbd194a0ffdc571bb9040124"
      },
      "after": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.160/officecli-mac-arm64",
        "sha256": "fe2b31c6c27534dfbbf155386b6b9105420f9315bbb606335ec61490d171386d"
      }
    },
    {
      "key": "darwin-x64",
      "before": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-mac-x64",
        "sha256": "178c1e9ebaf44c24d2b4b359064a5dea6eb7b2f539809871a3de1c09599dff9f"
      },
      "after": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.160/officecli-mac-x64",
        "sha256": "55b27f6d422f9e0bcd2aa40abb262606110ff957a4a5253db7a8ba0460cd81c7"
      }
    },
    {
      "key": "linux-arm64",
      "before": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-linux-arm64",
        "sha256": "60db926c8a1371984b9e99622a834777befb02b6f73d0f3fff914ffcc2760d2f"
      },
      "after": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.160/officecli-linux-arm64",
        "sha256": "e8f06aff6c59f11a73a1a1218bda3ce170299201fd56bce6d62ecd4d0c024e53"
      }
    },
    {
      "key": "linux-x64",
      "before": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-linux-x64",
        "sha256": "f8eefe88dbfa7464bee421e5421efe57fc26bc3180b30e56eef58594c8245c94"
      },
      "after": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.160/officecli-linux-x64",
        "sha256": "baa084b64ec634bd9d41a0592db3ed85f11658b358bab898679537ea7f3e73a9"
      }
    },
    {
      "key": "win32-arm64",
      "before": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-win-arm64.exe",
        "sha256": "786e08b1ccf09c3a2107912537fe25fa82970b30145e3c59e09d83bf4032b065"
      },
      "after": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.160/officecli-win-arm64.exe",
        "sha256": "65129df43a4eb8199f3ebf6b17b56c5311242f53c5f725f60efb0a94f8952d74"
      }
    },
    {
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-win-x64.exe",
        "sha256": "bd64eba587e56cc71709cdd1f38ae9ac77cd65a9c8ea744b0996897c0557e343",
        "schemaCrc": "c11d61e0"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.160/officecli-win-x64.exe",
        "sha256": "c590ca9d464f2b03362825b0f2615efcae33ce3fc0edaeeef29f7ddacb4c5424"
      }
    }
  ]
}
```

## 外部渲染依赖

```json
[]
```

## 需要复验的兼容 Recipe

```json
{}
```

> 此报告只用于人工审查。运行时自更新保持禁用，升级工作流不会自动合并 PR。

## Selection test 分支升级验证（2026-11-02）

- 按 LinNai 指令直接在 test 更新，基线为 `3598245a3ec6d74c59351eb5ff6c0ff6a243723a`。
- 复用升级 PR #701 的 Linux 标准快照（提交 `7fc0563789004324038f3ef14cbd168dc51eb8f4`），六平台校验和与上游 v1.0.160 的 SHA256SUMS 一致。
- `officecli:prepare`、`officecli:check` 通过：macOS arm64 二进制、命令 schema、策略与指南一致。
- 同步治理测试 16 pass / 0 fail；全仓 `typecheck:all` 通过。
- 按 CI 准备打包资源和受管 Bun 后，OfficeCLI 集成测试 134 pass / 0 fail，8 个文件、818 个断言；覆盖真实 Word / Excel / PPT 编辑、宏保留、导入、模板保真和外来稿摘要。
- 修复升级验证入口：PPT 样例路径从锁定清单读取版本，测试脚本显式指定源文件路径，避免误扫本地 dist 镜像。首轮缺打包环境和旧路径的失败不计为通过。
- 本地验证平台为 macOS arm64；Windows 集成及 test 发布 CI 由推送后的 Actions 单独核验，不以本地结果替代。
