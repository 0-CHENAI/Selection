# OfficeCLI 升级差异报告

- 旧版本：1.0.144 (b2b0b395)
- 新版本：1.0.144 (b2b0b395)
- 上游 tag commit：1ced45e900782c5083ed550ddf328ee974e425e7
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
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-win-x64.exe",
        "sha256": "e780cc6a5385f84b4d54d71b0c179904ed534125ec33fe39b1a8711fa80e387e",
        "schemaCrc": "22d3fc61"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.144/officecli-win-x64.exe",
        "sha256": "e780cc6a5385f84b4d54d71b0c179904ed534125ec33fe39b1a8711fa80e387e"
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
