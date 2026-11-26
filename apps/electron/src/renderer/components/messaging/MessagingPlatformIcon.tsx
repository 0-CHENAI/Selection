import weixinIcon from '@/assets/messaging-icons/weixin.svg'
import larkIcon from '@/assets/messaging-icons/lark.svg'

export function LarkIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <img src={larkIcon} alt="" width={size} height={size} className={className} />
}

export function WeixinIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <img src={weixinIcon} alt="" width={size} height={size} className={className} />
}
