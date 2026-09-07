import { useSyncExternalStore } from "react"

const key = "kb-console-background"
const eventName = "kb-background-change"

function readBackground() {
  try {
    const value = localStorage.getItem(key)
    return value?.startsWith("data:image/jpeg;base64,") ? value : ""
  } catch {
    return ""
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(eventName, callback)
    window.removeEventListener("storage", callback)
  }
}

export function useBackground() {
  return useSyncExternalStore(subscribe, readBackground, () => "")
}

export function saveBackground(value: string) {
  if (value) localStorage.setItem(key, value)
  else localStorage.removeItem(key)
  window.dispatchEvent(new Event(eventName))
}

export async function prepareBackground(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("请选择 JPG、PNG 或 WebP 图片。")
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10 MB。")
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("浏览器无法处理图片。")
    context.fillStyle = "#101218"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.8)
  } finally {
    bitmap.close()
  }
}
