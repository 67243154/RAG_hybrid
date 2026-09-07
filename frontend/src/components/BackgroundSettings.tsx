import { useState, type ChangeEvent } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { prepareBackground, saveBackground, useBackground } from "@/lib/background"

export function BackgroundSettings() {
  const background = useBackground()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setBusy(true)
    setMessage("")
    try {
      saveBackground(await prepareBackground(file))
      setMessage("背景已保存，刷新后仍然有效。")
    } catch (error) {
      setMessage(error instanceof Error && error.name !== "QuotaExceededError"
        ? `保存失败：${error.message}`
        : "浏览器存储空间不足，请选择较小的图片。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>外观与背景</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          选择本地图片作为全站背景，搭配半透明毛玻璃面板。支持 JPG、PNG、WebP，最大 10 MB。图片仅保存在当前浏览器，不会上传到服务器。
        </p>
        {background && <img src={background} alt="当前背景预览" className="h-36 w-full rounded-md object-cover" />}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            <span className="sr-only">上传背景图片</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={upload}
              className="max-w-full text-xs file:mr-3 file:rounded-md file:border file:border-[var(--color-border)] file:bg-[var(--color-surface-raised)] file:px-3 file:py-2 file:text-[var(--color-foreground)] disabled:opacity-50" />
          </label>
          <button type="button" disabled={busy || !background} className="rounded-md border px-3 py-2 text-xs disabled:opacity-40"
            onClick={() => {
              try {
                saveBackground("")
                setMessage("已恢复默认背景。")
              } catch {
                setMessage("无法清除背景，请检查浏览器存储权限。")
              }
            }}>恢复默认背景</button>
        </div>
        <p role="status" className="text-xs text-[var(--color-muted-foreground)]">{busy ? "正在处理图片…" : message}</p>
      </CardContent>
    </Card>
  )
}
