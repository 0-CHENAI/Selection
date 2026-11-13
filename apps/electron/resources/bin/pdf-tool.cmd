@echo off
if defined UV_PYTHON (
  "%CRAFT_UV%" run --python "%UV_PYTHON%" "%CRAFT_SCRIPTS%\pdf_tool.py" %*
) else (
  "%CRAFT_UV%" run --python 3.12 "%CRAFT_SCRIPTS%\pdf_tool.py" %*
)
