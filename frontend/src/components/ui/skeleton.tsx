import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("sr-skel rounded-[4px]", className)}
      {...props}
    />
  )
}

export { Skeleton }
