# OfficeCLI 升级差异报告

- 旧版本：1.0.146 (909df808)
- 新版本：1.0.147 (909df808)
- 上游 tag commit：b94f3906fd52d450c64f8e40370e376b9e15079e
- 未分类命令：无
- 过期分类：无

## 命令

```json
{
  "added": [],
  "removed": [],
  "flagChanges": [
    {
      "command": "import",
      "added": [
        "--decimal",
        "--delimiter"
      ],
      "removed": []
    }
  ]
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-mac-arm64",
        "sha256": "fdad1c51a95d18c4851f54327b7eec9f766b12a984e0930b48d877d5559e3161"
      },
      "after": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.147/officecli-mac-arm64",
        "sha256": "55569d8a7430c1d8d7872c1661ff8cfea2eeef03ffc4fa8dbee437a4c91ee1ed"
      }
    },
    {
      "key": "darwin-x64",
      "before": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-mac-x64",
        "sha256": "2b5547588a69270f649fbe623c4541755510f7501717f830e656a5408062198f"
      },
      "after": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.147/officecli-mac-x64",
        "sha256": "9f957b9439b922916360189bedfb780defc471b95ab8670f2a5a9630e7c9c253"
      }
    },
    {
      "key": "linux-arm64",
      "before": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-linux-arm64",
        "sha256": "b3204a1a8a7949e44638267722f2abb6135be89f83f138fb6bea586c0e57af30"
      },
      "after": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.147/officecli-linux-arm64",
        "sha256": "f90c734722fd2f41ae76e72878329f033ed36c132aa741ec44dc3827066c55b9"
      }
    },
    {
      "key": "linux-x64",
      "before": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-linux-x64",
        "sha256": "bd343d96018a9ec4a72ff3599877a4fc4fed233258a62eddc06169711170d843"
      },
      "after": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.147/officecli-linux-x64",
        "sha256": "e8bfe04f670139f526fe4e81f11acc1bc8629e421a20c5ba7a6e25f7a54a31f7"
      }
    },
    {
      "key": "win32-arm64",
      "before": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-win-arm64.exe",
        "sha256": "8a9d9edac22afd21c492a50f7866898863367cce103bc9b7e924e3528ff5e1fa"
      },
      "after": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.147/officecli-win-arm64.exe",
        "sha256": "7ff0195c32405bac9cf6a32589d984fa7a863adfabbc6e42dfef47a7839264cf"
      }
    },
    {
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-win-x64.exe",
        "sha256": "ad36ca99a50102d8f953e8ed1742fab65c9e201a29733601ea6ca9e676b2eed0",
        "schemaCrc": "69cd35d9"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.147/officecli-win-x64.exe",
        "sha256": "724056e5ff079c3585df79c8afc386f08ef7d5f956cf4e2723534e129aab6e80"
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

> 此报告只用于人工审查。运行时自更新保持禁用，draft PR 不会自动合并。
