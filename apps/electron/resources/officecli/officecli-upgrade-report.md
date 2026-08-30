# OfficeCLI 升级差异报告

- 旧版本：1.0.144 (b2b0b395)
- 新版本：1.0.145 (b2b0b395)
- 上游 tag commit：e402d2853259177aba05ee6f79d38b7e1ff067ae
- 未分类命令：无
- 过期分类：无

## 命令

```json
{
  "added": [],
  "removed": [],
  "flagChanges": []
}
```

## Guides 与资源

```json
[]
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-mac-arm64",
        "sha256": "04757163428c5bde8d91e8f838517818e74722157722ca5f3877b6716b77bd45"
      },
      "after": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-mac-arm64",
        "sha256": "d66763a563bc844c3cc67036ebc7c4a9caa9319b9592814d9acd3706da231fc1"
      }
    },
    {
      "key": "darwin-x64",
      "before": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-mac-x64",
        "sha256": "366100643d757b0da24829422897ca74768a894b5ecd1a471a1336f8e2a0787d"
      },
      "after": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-mac-x64",
        "sha256": "d7dc7013f7bf0af6345ae16a7913e6cf041947460d7f2fa3e024f0b27073d0a2"
      }
    },
    {
      "key": "linux-arm64",
      "before": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-linux-arm64",
        "sha256": "56ec2c3114b66f6490888b6778cbb8413a65911a26cacc7207f29e13424966da"
      },
      "after": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-linux-arm64",
        "sha256": "d38233bb7df4f0f5fb40313de1f00c0f0e575dc96b4164742709711ceec148c5"
      }
    },
    {
      "key": "linux-x64",
      "before": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-linux-x64",
        "sha256": "32ef7a21a54a4ca6c9806bf5e9f3d32bfb1291017329c55044cb2aac71822eb8"
      },
      "after": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-linux-x64",
        "sha256": "449f0e6a1298e3c6d7da792d26ab53d04ba77bd990f299b51123c7aef383d2ce"
      }
    },
    {
      "key": "win32-arm64",
      "before": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-win-arm64.exe",
        "sha256": "0adb928d118e237b108077dadca9e272c236cd378c699712a41adda697047860"
      },
      "after": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-win-arm64.exe",
        "sha256": "9ab800745ef06f4d30b8fd41729c516a4b28c86a24a32af8764d12a6a5226d57"
      }
    },
    {
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-win-x64.exe",
        "sha256": "e780cc6a5385f84b4d54d71b0c179904ed534125ec33fe39b1a8711fa80e387e",
        "schemaCrc": "22d3fc61"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-win-x64.exe",
        "sha256": "760696b262f3d6bd2cd174577220d54541b6e1e04ec58dee051f1897395638b8"
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
{
  "importViaAtomicBatch": {
    "enabled": true,
    "maxSourceBytes": 5000000,
    "reason": "The reviewed OfficeCLI release reports successful CSV/TSV import without persisting worksheet cells; use one atomic native batch until a reviewed upgrade passes the real content assertion."
  }
}
```

> 此报告只用于人工审查。运行时自更新保持禁用，draft PR 不会自动合并。
