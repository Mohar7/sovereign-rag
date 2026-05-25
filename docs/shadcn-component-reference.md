# shadcn/ui — Component reference bundle

Attach this file to your Claude Design thread alongside `frontend-redesign-prompt.md`. It enumerates every shadcn/ui primitive that will exist in the new sovereign-rag frontend, with a canonical usage snippet for the most-used ones and a short description for the rest. Use it as the component contract — every screen Claude Design produces must be expressible in terms of these.

**Registry style:** `new-york-v4`
**Framework:** Vite + React 18/19 + Tailwind v4 + TypeScript
**Companion libraries:** TanStack Router/Query/Table/Form · i18next · lucide-react icons · sonner (already wrapped by `<Toast>`/`toast()`) · recharts (via shadcn `chart`)

---

## 0 · One-shot install (engineering reference)

After `npm create vite@latest` + `npx shadcn@latest init`:

```bash
npx shadcn@latest add \
  accordion alert alert-dialog aspect-ratio avatar badge breadcrumb \
  button button-group calendar card carousel chart checkbox collapsible \
  combobox command context-menu dialog drawer dropdown-menu empty field \
  form hover-card input input-group input-otp item kbd label menubar \
  native-select navigation-menu pagination popover progress radio-group \
  resizable scroll-area select separator sheet sidebar skeleton slider \
  sonner spinner switch table tabs textarea toggle toggle-group tooltip
```

Additional packages:

```bash
npm i @tanstack/react-router @tanstack/react-query @tanstack/react-table \
      @tanstack/react-form i18next react-i18next i18next-browser-languagedetector \
      lucide-react sonner recharts zod @hookform/resolvers react-hook-form
```

---

## 1 · Catalog

All component imports in the new project come from `@/components/ui/<name>` (shadcn convention). The examples below use the registry path so you can paste them verbatim into Claude Design.

### accordion

Collapsible vertical stack of sections.

```tsx
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"

<Accordion type="single" collapsible defaultValue="item-1" className="w-full">
  <AccordionItem value="item-1">
    <AccordionTrigger>Product Information</AccordionTrigger>
    <AccordionContent className="flex flex-col gap-4 text-balance">
      <p>Our flagship product…</p>
    </AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-2">
    <AccordionTrigger>Shipping Details</AccordionTrigger>
    <AccordionContent>…</AccordionContent>
  </AccordionItem>
</Accordion>
```

### alert

Inline banner with icon + title + optional description. Variants: `default`, `destructive`.

```tsx
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

<Alert>
  <CheckCircle2Icon />
  <AlertTitle>Success! Your changes have been saved</AlertTitle>
  <AlertDescription>This is an alert with icon, title and description.</AlertDescription>
</Alert>

<Alert variant="destructive">
  <AlertCircleIcon />
  <AlertTitle>Unable to process your payment.</AlertTitle>
  <AlertDescription>
    <p>Please verify your billing information and try again.</p>
    <ul className="list-inside list-disc text-sm">
      <li>Check your card details</li>
    </ul>
  </AlertDescription>
</Alert>
```

### alert-dialog

Blocking confirmation dialog (vs. `dialog`, which is for forms / non-blocking).

```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="outline">Show Dialog</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone. This will permanently delete your account.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction>Continue</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### aspect-ratio

Locks a child to a fixed aspect ratio.

```tsx
import { AspectRatio } from "@/components/ui/aspect-ratio"
<AspectRatio ratio={16/9}><img src="..." /></AspectRatio>
```

### avatar

```tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

<Avatar>
  <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
  <AvatarFallback>CN</AvatarFallback>
</Avatar>

{/* Stacked group with ring */}
<div className="flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background">
  <Avatar><AvatarImage src="..." /></Avatar>
  <Avatar><AvatarImage src="..." /></Avatar>
</div>
```

### badge

Variants: `default`, `secondary`, `destructive`, `outline`. Can wrap an icon.

```tsx
import { Badge } from "@/components/ui/badge"
import { BadgeCheckIcon } from "lucide-react"

<Badge>Badge</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Destructive</Badge>
<Badge variant="outline">Outline</Badge>

<Badge variant="secondary" className="bg-blue-500 text-white">
  <BadgeCheckIcon /> Verified
</Badge>

{/* Notification counter */}
<Badge className="h-5 min-w-5 rounded-full px-1 font-mono tabular-nums">99</Badge>
```

### breadcrumb

```tsx
import {
  Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Link } from "@tanstack/react-router"

<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Home</Link></BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbLink asChild><Link to="/library">Library</Link></BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Document</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

### button

Variants: `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`. Sizes: `default`, `sm`, `lg`, `icon`.

```tsx
import { Button } from "@/components/ui/button"
import { ArrowUpIcon } from "lucide-react"

<Button>Default</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Delete</Button>

<Button variant="outline" size="icon" aria-label="Submit"><ArrowUpIcon /></Button>

{/* As Link (asChild) */}
<Button asChild><Link to="/settings">Settings</Link></Button>
```

### button-group

Group buttons (with optional separators / nested dropdowns).

```tsx
import { ButtonGroup } from "@/components/ui/button-group"
import { Button } from "@/components/ui/button"

<ButtonGroup>
  <Button variant="outline">Archive</Button>
  <Button variant="outline">Report</Button>
  <Button variant="outline">Snooze</Button>
</ButtonGroup>
```

### calendar

Date picker primitive built on react-day-picker.

```tsx
import { Calendar } from "@/components/ui/calendar"

const [date, setDate] = React.useState<Date | undefined>(new Date())
<Calendar mode="single" selected={date} onSelect={setDate} captionLayout="dropdown" className="rounded-md border shadow-sm" />
```

### card

```tsx
import {
  Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card"

<Card className="w-full max-w-sm">
  <CardHeader>
    <CardTitle>Login to your account</CardTitle>
    <CardDescription>Enter your email below.</CardDescription>
    <CardAction><Button variant="link">Sign Up</Button></CardAction>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter className="flex-col gap-2">
    <Button type="submit" className="w-full">Login</Button>
  </CardFooter>
</Card>
```

### carousel

Slider built on embla-carousel.

```tsx
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"

<Carousel className="w-full max-w-xs">
  <CarouselContent>
    {items.map((it) => (
      <CarouselItem key={it.id}>…</CarouselItem>
    ))}
  </CarouselContent>
  <CarouselPrevious />
  <CarouselNext />
</Carousel>
```

### chart

Recharts wrapper that uses CSS variables for theming. Use shadcn `chart` for the Evals dashboard. See https://ui.shadcn.com/docs/components/chart for all variants (area / bar / line / pie / radar / radial).

```tsx
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

const chartConfig = {
  desktop: { label: "Desktop", color: "var(--chart-1)" },
  mobile:  { label: "Mobile",  color: "var(--chart-2)" },
} satisfies ChartConfig

<ChartContainer config={chartConfig} className="h-[260px] w-full">
  <BarChart data={data}>
    <CartesianGrid vertical={false} />
    <XAxis dataKey="month" />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
    <Bar dataKey="mobile"  fill="var(--color-mobile)"  radius={4} />
  </BarChart>
</ChartContainer>
```

### checkbox

```tsx
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

<div className="flex items-center gap-3">
  <Checkbox id="terms" />
  <Label htmlFor="terms">Accept terms and conditions</Label>
</div>

<div className="flex items-start gap-3">
  <Checkbox id="terms-2" defaultChecked />
  <div className="grid gap-2">
    <Label htmlFor="terms-2">Accept terms</Label>
    <p className="text-sm text-muted-foreground">By clicking, you agree…</p>
  </div>
</div>
```

### collapsible

Single-section disclosure (vs. accordion's multi-section).

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronsUpDown } from "lucide-react"

<Collapsible className="flex w-[350px] flex-col gap-2">
  <div className="flex items-center justify-between gap-4 px-4">
    <h4 className="text-sm font-semibold">@peduarte starred 3 repositories</h4>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="icon" className="size-8"><ChevronsUpDown /></Button>
    </CollapsibleTrigger>
  </div>
  <CollapsibleContent className="flex flex-col gap-2">…</CollapsibleContent>
</Collapsible>
```

### combobox

Composed from Command + Popover. Use this for the model picker / single-select autocomplete.

```tsx
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
    <Button variant="outline" role="combobox" aria-expanded={open} className="w-[200px] justify-between">
      {value ? options.find((o) => o.value === value)?.label : "Select…"}
      <ChevronsUpDown className="opacity-50" />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-[200px] p-0">
    <Command>
      <CommandInput placeholder="Search…" className="h-9" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup>
          {options.map((o) => (
            <CommandItem key={o.value} value={o.value} onSelect={(v) => { setValue(v); setOpen(false) }}>
              {o.label}
              <Check className={cn("ml-auto", value === o.value ? "opacity-100" : "opacity-0")} />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>
```

### command

Cmdk-style command palette primitive. Wrap in a `CommandDialog` for ⌘K UX.

```tsx
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem,
  CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command"

<Command className="rounded-lg border shadow-md md:min-w-[450px]">
  <CommandInput placeholder="Type a command or search..." />
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    <CommandGroup heading="Suggestions">
      <CommandItem><Calendar /><span>Calendar</span></CommandItem>
      <CommandItem disabled><Calculator /><span>Calculator</span></CommandItem>
    </CommandGroup>
    <CommandSeparator />
    <CommandGroup heading="Settings">
      <CommandItem>
        <User /><span>Profile</span>
        <CommandShortcut>⌘P</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  </CommandList>
</Command>
```

### context-menu

Right-click menu with sub-menus, checkbox items, radio groups.

```tsx
import {
  ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem,
  ContextMenuLabel, ContextMenuRadioGroup, ContextMenuRadioItem,
  ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu"

<ContextMenu>
  <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed">
    Right click here
  </ContextMenuTrigger>
  <ContextMenuContent className="w-52">
    <ContextMenuItem inset>Back <ContextMenuShortcut>⌘[</ContextMenuShortcut></ContextMenuItem>
    <ContextMenuItem inset disabled>Forward</ContextMenuItem>
    <ContextMenuSub>
      <ContextMenuSubTrigger inset>More Tools</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem>Save Page…</ContextMenuItem>
        <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSeparator />
    <ContextMenuCheckboxItem checked>Show Bookmarks</ContextMenuCheckboxItem>
  </ContextMenuContent>
</ContextMenu>
```

### dialog

Modal dialog with optional form.

```tsx
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"

<Dialog>
  <form>
    <DialogTrigger asChild><Button variant="outline">Open Dialog</Button></DialogTrigger>
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Edit profile</DialogTitle>
        <DialogDescription>Make changes to your profile here.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-3"><Label htmlFor="name">Name</Label><Input id="name" defaultValue="Pedro" /></div>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button type="submit">Save changes</Button>
      </DialogFooter>
    </DialogContent>
  </form>
</Dialog>
```

### drawer

Bottom-sheet on mobile, side-sheet on desktop. Built on vaul.

```tsx
import {
  Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter,
  DrawerHeader, DrawerTitle, DrawerTrigger,
} from "@/components/ui/drawer"

<Drawer>
  <DrawerTrigger asChild><Button variant="outline">Open Drawer</Button></DrawerTrigger>
  <DrawerContent>
    <div className="mx-auto w-full max-w-sm">
      <DrawerHeader>
        <DrawerTitle>Move Goal</DrawerTitle>
        <DrawerDescription>Set your daily activity goal.</DrawerDescription>
      </DrawerHeader>
      …
      <DrawerFooter>
        <Button>Submit</Button>
        <DrawerClose asChild><Button variant="outline">Cancel</Button></DrawerClose>
      </DrawerFooter>
    </div>
  </DrawerContent>
</Drawer>
```

### dropdown-menu

Click-to-open menu with sub-menus, shortcuts, separators, groups.

```tsx
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuPortal, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

<DropdownMenu>
  <DropdownMenuTrigger asChild><Button variant="outline">Open</Button></DropdownMenuTrigger>
  <DropdownMenuContent className="w-56" align="start">
    <DropdownMenuLabel>My Account</DropdownMenuLabel>
    <DropdownMenuGroup>
      <DropdownMenuItem>Profile<DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem>Billing</DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Invite users</DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          <DropdownMenuItem>Email</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
    <DropdownMenuItem disabled>API</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### empty

Empty-state primitive: icon + title + description + optional action. https://ui.shadcn.com/docs/components/empty

```tsx
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

<Empty>
  <EmptyHeader>
    <EmptyMedia><Inbox /></EmptyMedia>
    <EmptyTitle>No documents yet</EmptyTitle>
    <EmptyDescription>Ingest a PDF or URL to get started.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent><Button>Ingest a document</Button></EmptyContent>
</Empty>
```

### field

Field wrapper used by Forms (works with react-hook-form, TanStack Form, formisch, native form actions). Provides label, description, error rendering. https://ui.shadcn.com/docs/components/field

```tsx
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"

<FieldGroup>
  <Field data-invalid={!!errors.title}>
    <FieldLabel htmlFor="title">Title</FieldLabel>
    <Input id="title" {...register("title")} />
    <FieldDescription>Give it a short name.</FieldDescription>
    {errors.title && <FieldError>{errors.title.message}</FieldError>}
  </Field>
</FieldGroup>
```

### form

Form integration with **TanStack Form** (also supports react-hook-form, formisch, Next form actions).

```tsx
import { useForm } from "@tanstack/react-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const schema = z.object({ title: z.string().min(5) })

const form = useForm({
  defaultValues: { title: "" },
  validators: { onSubmit: schema },
  onSubmit: async ({ value }) => { /* … */ },
})

<form onSubmit={(e) => { e.preventDefault(); form.handleSubmit() }}>
  <FieldGroup>
    <form.Field name="title" children={(field) => {
      const invalid = field.state.meta.isTouched && !field.state.meta.isValid
      return (
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={field.name}>Title</FieldLabel>
          <Input id={field.name} value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)} />
          {invalid && <FieldError errors={field.state.meta.errors} />}
        </Field>
      )
    }} />
  </FieldGroup>
  <Button type="submit">Submit</Button>
</form>
```

### hover-card

Card that appears on hover (e.g. user mentions, citation snippets).

```tsx
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

<HoverCard>
  <HoverCardTrigger asChild><Button variant="link">@nextjs</Button></HoverCardTrigger>
  <HoverCardContent className="w-80">
    <div className="flex justify-between gap-4">
      <Avatar><AvatarImage src="..." /><AvatarFallback>VC</AvatarFallback></Avatar>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">@nextjs</h4>
        <p className="text-sm">The React Framework.</p>
        <div className="text-xs text-muted-foreground">Joined December 2021</div>
      </div>
    </div>
  </HoverCardContent>
</HoverCard>
```

### input

```tsx
import { Input } from "@/components/ui/input"
<Input type="email" placeholder="Email" />
```

### input-group

Input with leading/trailing slots (search icon, units, action buttons). Replaces ad-hoc wrappers.

```tsx
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput,
  InputGroupText, InputGroupTextarea,
} from "@/components/ui/input-group"
import { Search, ArrowUpIcon } from "lucide-react"

{/* Search field */}
<InputGroup>
  <InputGroupInput placeholder="Search…" />
  <InputGroupAddon><Search /></InputGroupAddon>
  <InputGroupAddon align="inline-end">12 results</InputGroupAddon>
</InputGroup>

{/* URL field with prefix */}
<InputGroup>
  <InputGroupInput placeholder="example.com" className="pl-1!" />
  <InputGroupAddon><InputGroupText>https://</InputGroupText></InputGroupAddon>
</InputGroup>

{/* Composer-style textarea with toolbar */}
<InputGroup>
  <InputGroupTextarea placeholder="Ask, Search or Chat..." />
  <InputGroupAddon align="block-end">
    <InputGroupButton variant="outline" className="rounded-full" size="icon-xs"><IconPlus /></InputGroupButton>
    <InputGroupText className="ml-auto">52% used</InputGroupText>
    <InputGroupButton variant="default" className="rounded-full" size="icon-xs" disabled>
      <ArrowUpIcon /><span className="sr-only">Send</span>
    </InputGroupButton>
  </InputGroupAddon>
</InputGroup>
```

### input-otp

```tsx
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"

<InputOTP maxLength={6}>
  <InputOTPGroup>
    <InputOTPSlot index={0} />
    <InputOTPSlot index={1} />
    <InputOTPSlot index={2} />
  </InputOTPGroup>
  <InputOTPSeparator />
  <InputOTPGroup>
    <InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} />
  </InputOTPGroup>
</InputOTP>
```

### item

List/menu item primitive that pairs with Field/InputGroup. https://ui.shadcn.com/docs/components/item

### kbd

Inline keyboard hint chip.

```tsx
import { Kbd } from "@/components/ui/kbd"
<span>Press <Kbd>⌘</Kbd><Kbd>K</Kbd> to open</span>
```

### label

```tsx
import { Label } from "@/components/ui/label"
<Label htmlFor="email">Email</Label>
```

### menubar

App-style top menu bar (File / Edit / View / …). Use only if you actually want a desktop menubar UI.

### native-select

Native `<select>` styled to match. Use when you want native mobile picker behavior.

```tsx
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

<NativeSelect>
  <NativeSelectOption value="">Select status</NativeSelectOption>
  <NativeSelectOption value="todo">Todo</NativeSelectOption>
  <NativeSelectOption value="done">Done</NativeSelectOption>
</NativeSelect>
```

### navigation-menu

Horizontal app-nav menu with mega-menu support. Less common in app UIs — usually marketing/landing.

### pagination

```tsx
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"

<Pagination>
  <PaginationContent>
    <PaginationItem><PaginationPrevious href="#" /></PaginationItem>
    <PaginationItem><PaginationLink href="#">1</PaginationLink></PaginationItem>
    <PaginationItem><PaginationLink href="#" isActive>2</PaginationLink></PaginationItem>
    <PaginationItem><PaginationLink href="#">3</PaginationLink></PaginationItem>
    <PaginationItem><PaginationEllipsis /></PaginationItem>
    <PaginationItem><PaginationNext href="#" /></PaginationItem>
  </PaginationContent>
</Pagination>
```

### popover

Generic floating panel anchored to a trigger.

```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

<Popover>
  <PopoverTrigger asChild><Button variant="outline">Open popover</Button></PopoverTrigger>
  <PopoverContent className="w-80">
    <div className="grid gap-4">
      <div className="space-y-2">
        <h4 className="leading-none font-medium">Dimensions</h4>
        <p className="text-sm text-muted-foreground">Set the dimensions for the layer.</p>
      </div>
      …
    </div>
  </PopoverContent>
</Popover>
```

### progress

```tsx
import { Progress } from "@/components/ui/progress"
<Progress value={66} className="w-[60%]" />
```

### radio-group

```tsx
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"

<RadioGroup defaultValue="comfortable">
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="default" id="r1" />
    <Label htmlFor="r1">Default</Label>
  </div>
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="comfortable" id="r2" />
    <Label htmlFor="r2">Comfortable</Label>
  </div>
</RadioGroup>
```

### resizable

Draggable resizable panels (use for the Ask shell's three-column layout — center pane + sources rail).

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

<ResizablePanelGroup direction="horizontal" className="min-h-[200px] max-w-md rounded-lg border">
  <ResizablePanel defaultSize={50}>Conversation</ResizablePanel>
  <ResizableHandle />
  <ResizablePanel defaultSize={50}>Sources</ResizablePanel>
</ResizablePanelGroup>
```

### scroll-area

Custom-styled scrollbar that matches the design across browsers.

```tsx
import { ScrollArea } from "@/components/ui/scroll-area"

<ScrollArea className="h-[200px] w-[350px] rounded-md border p-4">
  …long content…
</ScrollArea>
```

### select

Custom popover-style select. Use when you want full design control (over `native-select`).

```tsx
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select"

<Select>
  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select a fruit" /></SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Fruits</SelectLabel>
      <SelectItem value="apple">Apple</SelectItem>
      <SelectItem value="banana">Banana</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

### separator

```tsx
import { Separator } from "@/components/ui/separator"
<Separator />
<Separator orientation="vertical" className="h-4" />
```

### sheet

Side-drawer (vs `drawer` which is bottom-sheet on mobile). Use this for the right-side Sources panel on `lg`+ and as the mobile-Sheet sidebar.

```tsx
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet"

<Sheet>
  <SheetTrigger asChild><Button variant="outline">Open</Button></SheetTrigger>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Edit profile</SheetTitle>
      <SheetDescription>Make changes to your profile here.</SheetDescription>
    </SheetHeader>
    …
    <SheetFooter>
      <Button type="submit">Save changes</Button>
      <SheetClose asChild><Button variant="outline">Close</Button></SheetClose>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

### sidebar

The shadcn `Sidebar` primitive — supports collapsible (icon-rail), inset (with rounded card), mobile-Sheet behavior, sub-menus, footers, headers. **This is the canonical app shell for the new frontend.**

Companion components: `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarRail`, `SidebarInset`, `SidebarTrigger`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton`, `SidebarMenuAction`, `useSidebar`.

```tsx
// Root layout
import { AppSidebar } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">Ask</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem><BreadcrumbPage>Current thread</BreadcrumbPage></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

```tsx
// app-sidebar.tsx — the collapsible icon-rail variant
import * as React from "react"
import { Bot, BookOpen, Settings2, SquareTerminal } from "lucide-react"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail,
} from "@/components/ui/sidebar"

const data = {
  user: { name: "user", email: "u@example.com", avatar: "" },
  navMain: [
    { title: "Ask",      url: "/",         icon: SquareTerminal, isActive: true },
    { title: "Library",  url: "/library",  icon: BookOpen },
    { title: "Ingest",   url: "/ingest",   icon: Bot },
    { title: "Settings", url: "/settings", icon: Settings2,
      items: [
        { title: "General", url: "/settings/general" },
        { title: "Retrieval", url: "/settings/retrieval" },
      ] },
  ],
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>{/* brand mark */}</SidebarHeader>
      <SidebarContent><NavMain items={data.navMain} /></SidebarContent>
      <SidebarFooter><NavUser user={data.user} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
```

```tsx
// nav-main.tsx — collapsible sub-menus
import { ChevronRight, type LucideIcon } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export function NavMain({ items }: { items: { title: string; url: string; icon?: LucideIcon; isActive?: boolean; items?: { title: string; url: string }[] }[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible key={item.title} asChild defaultOpen={item.isActive} className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={item.title}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  {item.items && (
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  )}
                </SidebarMenuButton># shadcn/ui — Component reference bundle

Attach this file to your Claude Design thread alongside `frontend-redesign-prompt.md`. It enumerates every shadcn/ui primitive that will exist in the new sovereign-rag frontend, with a canonical usage snippet for the most-used ones and a short description for the rest. Use it as the component contract — every screen Claude Design produces must be expressible in terms of these.

**Registry style:** `new-york-v4`
**Framework:** Vite + React 18/19 + Tailwind v4 + TypeScript
**Companion libraries:** TanStack Router/Query/Table/Form · i18next · lucide-react icons · sonner (already wrapped by `<Toast>`/`toast()`) · recharts (via shadcn `chart`)

---

## 0 · One-shot install (engineering reference)

After `npm create vite@latest` + `npx shadcn@latest init`:

```bash
npx shadcn@latest add \
  accordion alert alert-dialog aspect-ratio avatar badge breadcrumb \
  button button-group calendar card carousel chart checkbox collapsible \
  combobox command context-menu dialog drawer dropdown-menu empty field \
  form hover-card input input-group input-otp item kbd label menubar \
  native-select navigation-menu pagination popover progress radio-group \
  resizable scroll-area select separator sheet sidebar skeleton slider \
  sonner spinner switch table tabs textarea toggle toggle-group tooltip
```

Additional packages:

```bash
npm i @tanstack/react-router @tanstack/react-query @tanstack/react-table \
      @tanstack/react-form i18next react-i18next i18next-browser-languagedetector \
      lucide-react sonner recharts zod @hookform/resolvers react-hook-form
```

---

## 1 · Catalog

All component imports in the new project come from `@/components/ui/<name>` (shadcn convention). The examples below use the registry path so you can paste them verbatim into Claude Design.

### accordion

Collapsible vertical stack of sections.

```tsx
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion"

<Accordion type="single" collapsible defaultValue="item-1" className="w-full">
  <AccordionItem value="item-1">
    <AccordionTrigger>Product Information</AccordionTrigger>
    <AccordionContent className="flex flex-col gap-4 text-balance">
      <p>Our flagship product…</p>
    </AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-2">
    <AccordionTrigger>Shipping Details</AccordionTrigger>
    <AccordionContent>…</AccordionContent>
  </AccordionItem>
</Accordion>
```

### alert

Inline banner with icon + title + optional description. Variants: `default`, `destructive`.

```tsx
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

<Alert>
  <CheckCircle2Icon />
  <AlertTitle>Success! Your changes have been saved</AlertTitle>
  <AlertDescription>This is an alert with icon, title and description.</AlertDescription>
</Alert>

<Alert variant="destructive">
  <AlertCircleIcon />
  <AlertTitle>Unable to process your payment.</AlertTitle>
  <AlertDescription>
    <p>Please verify your billing information and try again.</p>
    <ul className="list-inside list-disc text-sm">
      <li>Check your card details</li>
    </ul>
  </AlertDescription>
</Alert>
```

### alert-dialog

Blocking confirmation dialog (vs. `dialog`, which is for forms / non-blocking).

```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="outline">Show Dialog</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone. This will permanently delete your account.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction>Continue</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### aspect-ratio

Locks a child to a fixed aspect ratio.

```tsx
import { AspectRatio } from "@/components/ui/aspect-ratio"
<AspectRatio ratio={16/9}><img src="..." /></AspectRatio>
```

### avatar

```tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

<Avatar>
  <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
  <AvatarFallback>CN</AvatarFallback>
</Avatar>

{/* Stacked group with ring */}
<div className="flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background">
  <Avatar><AvatarImage src="..." /></Avatar>
  <Avatar><AvatarImage src="..." /></Avatar>
</div>
```

### badge

Variants: `default`, `secondary`, `destructive`, `outline`. Can wrap an icon.

```tsx
import { Badge } from "@/components/ui/badge"
import { BadgeCheckIcon } from "lucide-react"

<Badge>Badge</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Destructive</Badge>
<Badge variant="outline">Outline</Badge>

<Badge variant="secondary" className="bg-blue-500 text-white">
  <BadgeCheckIcon /> Verified
</Badge>

{/* Notification counter */}
<Badge className="h-5 min-w-5 rounded-full px-1 font-mono tabular-nums">99</Badge>
```

### breadcrumb

```tsx
import {
  Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Link } from "@tanstack/react-router"

<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink asChild><Link to="/">Home</Link></BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbLink asChild><Link to="/library">Library</Link></BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Document</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

### button

Variants: `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`. Sizes: `default`, `sm`, `lg`, `icon`.

```tsx
import { Button } from "@/components/ui/button"
import { ArrowUpIcon } from "lucide-react"

<Button>Default</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Delete</Button>

<Button variant="outline" size="icon" aria-label="Submit"><ArrowUpIcon /></Button>

{/* As Link (asChild) */}
<Button asChild><Link to="/settings">Settings</Link></Button>
```

### button-group

Group buttons (with optional separators / nested dropdowns).

```tsx
import { ButtonGroup } from "@/components/ui/button-group"
import { Button } from "@/components/ui/button"

<ButtonGroup>
  <Button variant="outline">Archive</Button>
  <Button variant="outline">Report</Button>
  <Button variant="outline">Snooze</Button>
</ButtonGroup>
```

### calendar

Date picker primitive built on react-day-picker.

```tsx
import { Calendar } from "@/components/ui/calendar"

const [date, setDate] = React.useState<Date | undefined>(new Date())
<Calendar mode="single" selected={date} onSelect={setDate} captionLayout="dropdown" className="rounded-md border shadow-sm" />
```

### card

```tsx
import {
  Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card"

<Card className="w-full max-w-sm">
  <CardHeader>
    <CardTitle>Login to your account</CardTitle>
    <CardDescription>Enter your email below.</CardDescription>
    <CardAction><Button variant="link">Sign Up</Button></CardAction>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter className="flex-col gap-2">
    <Button type="submit" className="w-full">Login</Button>
  </CardFooter>
</Card>
```

### carousel

Slider built on embla-carousel.

```tsx
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"

<Carousel className="w-full max-w-xs">
  <CarouselContent>
    {items.map((it) => (
      <CarouselItem key={it.id}>…</CarouselItem>
    ))}
  </CarouselContent>
  <CarouselPrevious />
  <CarouselNext />
</Carousel>
```

### chart

Recharts wrapper that uses CSS variables for theming. Use shadcn `chart` for the Evals dashboard. See https://ui.shadcn.com/docs/components/chart for all variants (area / bar / line / pie / radar / radial).

```tsx
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

const chartConfig = {
  desktop: { label: "Desktop", color: "var(--chart-1)" },
  mobile:  { label: "Mobile",  color: "var(--chart-2)" },
} satisfies ChartConfig

<ChartContainer config={chartConfig} className="h-[260px] w-full">
  <BarChart data={data}>
    <CartesianGrid vertical={false} />
    <XAxis dataKey="month" />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
    <Bar dataKey="mobile"  fill="var(--color-mobile)"  radius={4} />
  </BarChart>
</ChartContainer>
```

### checkbox

```tsx
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

<div className="flex items-center gap-3">
  <Checkbox id="terms" />
  <Label htmlFor="terms">Accept terms and conditions</Label>
</div>

<div className="flex items-start gap-3">
  <Checkbox id="terms-2" defaultChecked />
  <div className="grid gap-2">
    <Label htmlFor="terms-2">Accept terms</Label>
    <p className="text-sm text-muted-foreground">By clicking, you agree…</p>
  </div>
</div>
```

### collapsible

Single-section disclosure (vs. accordion's multi-section).

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ChevronsUpDown } from "lucide-react"

<Collapsible className="flex w-[350px] flex-col gap-2">
  <div className="flex items-center justify-between gap-4 px-4">
    <h4 className="text-sm font-semibold">@peduarte starred 3 repositories</h4>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="icon" className="size-8"><ChevronsUpDown /></Button>
    </CollapsibleTrigger>
  </div>
  <CollapsibleContent className="flex flex-col gap-2">…</CollapsibleContent>
</Collapsible>
```

### combobox

Composed from Command + Popover. Use this for the model picker / single-select autocomplete.

```tsx
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

<Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild>
    <Button variant="outline" role="combobox" aria-expanded={open} className="w-[200px] justify-between">
      {value ? options.find((o) => o.value === value)?.label : "Select…"}
      <ChevronsUpDown className="opacity-50" />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-[200px] p-0">
    <Command>
      <CommandInput placeholder="Search…" className="h-9" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup>
          {options.map((o) => (
            <CommandItem key={o.value} value={o.value} onSelect={(v) => { setValue(v); setOpen(false) }}>
              {o.label}
              <Check className={cn("ml-auto", value === o.value ? "opacity-100" : "opacity-0")} />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>
```

### command

Cmdk-style command palette primitive. Wrap in a `CommandDialog` for ⌘K UX.

```tsx
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem,
  CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command"

<Command className="rounded-lg border shadow-md md:min-w-[450px]">
  <CommandInput placeholder="Type a command or search..." />
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    <CommandGroup heading="Suggestions">
      <CommandItem><Calendar /><span>Calendar</span></CommandItem>
      <CommandItem disabled><Calculator /><span>Calculator</span></CommandItem>
    </CommandGroup>
    <CommandSeparator />
    <CommandGroup heading="Settings">
      <CommandItem>
        <User /><span>Profile</span>
        <CommandShortcut>⌘P</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  </CommandList>
</Command>
```

### context-menu

Right-click menu with sub-menus, checkbox items, radio groups.

```tsx
import {
  ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem,
  ContextMenuLabel, ContextMenuRadioGroup, ContextMenuRadioItem,
  ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu"

<ContextMenu>
  <ContextMenuTrigger className="flex h-[150px] w-[300px] items-center justify-center rounded-md border border-dashed">
    Right click here
  </ContextMenuTrigger>
  <ContextMenuContent className="w-52">
    <ContextMenuItem inset>Back <ContextMenuShortcut>⌘[</ContextMenuShortcut></ContextMenuItem>
    <ContextMenuItem inset disabled>Forward</ContextMenuItem>
    <ContextMenuSub>
      <ContextMenuSubTrigger inset>More Tools</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem>Save Page…</ContextMenuItem>
        <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSeparator />
    <ContextMenuCheckboxItem checked>Show Bookmarks</ContextMenuCheckboxItem>
  </ContextMenuContent>
</ContextMenu>
```

### dialog

Modal dialog with optional form.

```tsx
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"

<Dialog>
  <form>
    <DialogTrigger asChild><Button variant="outline">Open Dialog</Button></DialogTrigger>
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Edit profile</DialogTitle>
        <DialogDescription>Make changes to your profile here.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-3"><Label htmlFor="name">Name</Label><Input id="name" defaultValue="Pedro" /></div>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button type="submit">Save changes</Button>
      </DialogFooter>
    </DialogContent>
  </form>
</Dialog>
```

### drawer

Bottom-sheet on mobile, side-sheet on desktop. Built on vaul.

```tsx
import {
  Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter,
  DrawerHeader, DrawerTitle, DrawerTrigger,
} from "@/components/ui/drawer"

<Drawer>
  <DrawerTrigger asChild><Button variant="outline">Open Drawer</Button></DrawerTrigger>
  <DrawerContent>
    <div className="mx-auto w-full max-w-sm">
      <DrawerHeader>
        <DrawerTitle>Move Goal</DrawerTitle>
        <DrawerDescription>Set your daily activity goal.</DrawerDescription>
      </DrawerHeader>
      …
      <DrawerFooter>
        <Button>Submit</Button>
        <DrawerClose asChild><Button variant="outline">Cancel</Button></DrawerClose>
      </DrawerFooter>
    </div>
  </DrawerContent>
</Drawer>
```

### dropdown-menu

Click-to-open menu with sub-menus, shortcuts, separators, groups.

```tsx
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuPortal, DropdownMenuSeparator,
  DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

<DropdownMenu>
  <DropdownMenuTrigger asChild><Button variant="outline">Open</Button></DropdownMenuTrigger>
  <DropdownMenuContent className="w-56" align="start">
    <DropdownMenuLabel>My Account</DropdownMenuLabel>
    <DropdownMenuGroup>
      <DropdownMenuItem>Profile<DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem>Billing</DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Invite users</DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          <DropdownMenuItem>Email</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
    <DropdownMenuItem disabled>API</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### empty

Empty-state primitive: icon + title + description + optional action. https://ui.shadcn.com/docs/components/empty

```tsx
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

<Empty>
  <EmptyHeader>
    <EmptyMedia><Inbox /></EmptyMedia>
    <EmptyTitle>No documents yet</EmptyTitle>
    <EmptyDescription>Ingest a PDF or URL to get started.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent><Button>Ingest a document</Button></EmptyContent>
</Empty>
```

### field

Field wrapper used by Forms (works with react-hook-form, TanStack Form, formisch, native form actions). Provides label, description, error rendering. https://ui.shadcn.com/docs/components/field

```tsx
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"

<FieldGroup>
  <Field data-invalid={!!errors.title}>
    <FieldLabel htmlFor="title">Title</FieldLabel>
    <Input id="title" {...register("title")} />
    <FieldDescription>Give it a short name.</FieldDescription>
    {errors.title && <FieldError>{errors.title.message}</FieldError>}
  </Field>
</FieldGroup>
```

### form

Form integration with **TanStack Form** (also supports react-hook-form, formisch, Next form actions).

```tsx
import { useForm } from "@tanstack/react-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const schema = z.object({ title: z.string().min(5) })

const form = useForm({
  defaultValues: { title: "" },
  validators: { onSubmit: schema },
  onSubmit: async ({ value }) => { /* … */ },
})

<form onSubmit={(e) => { e.preventDefault(); form.handleSubmit() }}>
  <FieldGroup>
    <form.Field name="title" children={(field) => {
      const invalid = field.state.meta.isTouched && !field.state.meta.isValid
      return (
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={field.name}>Title</FieldLabel>
          <Input id={field.name} value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.target.value)} />
          {invalid && <FieldError errors={field.state.meta.errors} />}
        </Field>
      )
    }} />
  </FieldGroup>
  <Button type="submit">Submit</Button>
</form>
```

### hover-card

Card that appears on hover (e.g. user mentions, citation snippets).

```tsx
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

<HoverCard>
  <HoverCardTrigger asChild><Button variant="link">@nextjs</Button></HoverCardTrigger>
  <HoverCardContent className="w-80">
    <div className="flex justify-between gap-4">
      <Avatar><AvatarImage src="..." /><AvatarFallback>VC</AvatarFallback></Avatar>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">@nextjs</h4>
        <p className="text-sm">The React Framework.</p>
        <div className="text-xs text-muted-foreground">Joined December 2021</div>
      </div>
    </div>
  </HoverCardContent>
</HoverCard>
```

### input

```tsx
import { Input } from "@/components/ui/input"
<Input type="email" placeholder="Email" />
```

### input-group

Input with leading/trailing slots (search icon, units, action buttons). Replaces ad-hoc wrappers.

```tsx
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput,
  InputGroupText, InputGroupTextarea,
} from "@/components/ui/input-group"
import { Search, ArrowUpIcon } from "lucide-react"

{/* Search field */}
<InputGroup>
  <InputGroupInput placeholder="Search…" />
  <InputGroupAddon><Search /></InputGroupAddon>
  <InputGroupAddon align="inline-end">12 results</InputGroupAddon>
</InputGroup>

{/* URL field with prefix */}
<InputGroup>
  <InputGroupInput placeholder="example.com" className="pl-1!" />
  <InputGroupAddon><InputGroupText>https://</InputGroupText></InputGroupAddon>
</InputGroup>

{/* Composer-style textarea with toolbar */}
<InputGroup>
  <InputGroupTextarea placeholder="Ask, Search or Chat..." />
  <InputGroupAddon align="block-end">
    <InputGroupButton variant="outline" className="rounded-full" size="icon-xs"><IconPlus /></InputGroupButton>
    <InputGroupText className="ml-auto">52% used</InputGroupText>
    <InputGroupButton variant="default" className="rounded-full" size="icon-xs" disabled>
      <ArrowUpIcon /><span className="sr-only">Send</span>
    </InputGroupButton>
  </InputGroupAddon>
</InputGroup>
```

### input-otp

```tsx
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp"

<InputOTP maxLength={6}>
  <InputOTPGroup>
    <InputOTPSlot index={0} />
    <InputOTPSlot index={1} />
    <InputOTPSlot index={2} />
  </InputOTPGroup>
  <InputOTPSeparator />
  <InputOTPGroup>
    <InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} />
  </InputOTPGroup>
</InputOTP>
```

### item

List/menu item primitive that pairs with Field/InputGroup. https://ui.shadcn.com/docs/components/item

### kbd

Inline keyboard hint chip.

```tsx
import { Kbd } from "@/components/ui/kbd"
<span>Press <Kbd>⌘</Kbd><Kbd>K</Kbd> to open</span>
```

### label

```tsx
import { Label } from "@/components/ui/label"
<Label htmlFor="email">Email</Label>
```

### menubar

App-style top menu bar (File / Edit / View / …). Use only if you actually want a desktop menubar UI.

### native-select

Native `<select>` styled to match. Use when you want native mobile picker behavior.

```tsx
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

<NativeSelect>
  <NativeSelectOption value="">Select status</NativeSelectOption>
  <NativeSelectOption value="todo">Todo</NativeSelectOption>
  <NativeSelectOption value="done">Done</NativeSelectOption>
</NativeSelect>
```

### navigation-menu

Horizontal app-nav menu with mega-menu support. Less common in app UIs — usually marketing/landing.

### pagination

```tsx
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"

<Pagination>
  <PaginationContent>
    <PaginationItem><PaginationPrevious href="#" /></PaginationItem>
    <PaginationItem><PaginationLink href="#">1</PaginationLink></PaginationItem>
    <PaginationItem><PaginationLink href="#" isActive>2</PaginationLink></PaginationItem>
    <PaginationItem><PaginationLink href="#">3</PaginationLink></PaginationItem>
    <PaginationItem><PaginationEllipsis /></PaginationItem>
    <PaginationItem><PaginationNext href="#" /></PaginationItem>
  </PaginationContent>
</Pagination>
```

### popover

Generic floating panel anchored to a trigger.

```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

<Popover>
  <PopoverTrigger asChild><Button variant="outline">Open popover</Button></PopoverTrigger>
  <PopoverContent className="w-80">
    <div className="grid gap-4">
      <div className="space-y-2">
        <h4 className="leading-none font-medium">Dimensions</h4>
        <p className="text-sm text-muted-foreground">Set the dimensions for the layer.</p>
      </div>
      …
    </div>
  </PopoverContent>
</Popover>
```

### progress

```tsx
import { Progress } from "@/components/ui/progress"
<Progress value={66} className="w-[60%]" />
```

### radio-group

```tsx
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"

<RadioGroup defaultValue="comfortable">
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="default" id="r1" />
    <Label htmlFor="r1">Default</Label>
  </div>
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="comfortable" id="r2" />
    <Label htmlFor="r2">Comfortable</Label>
  </div>
</RadioGroup>
```

### resizable

Draggable resizable panels (use for the Ask shell's three-column layout — center pane + sources rail).

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

<ResizablePanelGroup direction="horizontal" className="min-h-[200px] max-w-md rounded-lg border">
  <ResizablePanel defaultSize={50}>Conversation</ResizablePanel>
  <ResizableHandle />
  <ResizablePanel defaultSize={50}>Sources</ResizablePanel>
</ResizablePanelGroup>
```

### scroll-area

Custom-styled scrollbar that matches the design across browsers.

```tsx
import { ScrollArea } from "@/components/ui/scroll-area"

<ScrollArea className="h-[200px] w-[350px] rounded-md border p-4">
  …long content…
</ScrollArea>
```

### select

Custom popover-style select. Use when you want full design control (over `native-select`).

```tsx
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select"

<Select>
  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select a fruit" /></SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Fruits</SelectLabel>
      <SelectItem value="apple">Apple</SelectItem>
      <SelectItem value="banana">Banana</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

### separator

```tsx
import { Separator } from "@/components/ui/separator"
<Separator />
<Separator orientation="vertical" className="h-4" />
```

### sheet

Side-drawer (vs `drawer` which is bottom-sheet on mobile). Use this for the right-side Sources panel on `lg`+ and as the mobile-Sheet sidebar.

```tsx
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet"

<Sheet>
  <SheetTrigger asChild><Button variant="outline">Open</Button></SheetTrigger>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Edit profile</SheetTitle>
      <SheetDescription>Make changes to your profile here.</SheetDescription>
    </SheetHeader>
    …
    <SheetFooter>
      <Button type="submit">Save changes</Button>
      <SheetClose asChild><Button variant="outline">Close</Button></SheetClose>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

### sidebar

The shadcn `Sidebar` primitive — supports collapsible (icon-rail), inset (with rounded card), mobile-Sheet behavior, sub-menus, footers, headers. **This is the canonical app shell for the new frontend.**

Companion components: `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarRail`, `SidebarInset`, `SidebarTrigger`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton`, `SidebarMenuAction`, `useSidebar`.

```tsx
// Root layout
import { AppSidebar } from "@/components/app-sidebar"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">Ask</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem><BreadcrumbPage>Current thread</BreadcrumbPage></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

```tsx
// app-sidebar.tsx — the collapsible icon-rail variant
import * as React from "react"
import { Bot, BookOpen, Settings2, SquareTerminal } from "lucide-react"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail,
} from "@/components/ui/sidebar"

const data = {
  user: { name: "user", email: "u@example.com", avatar: "" },
  navMain: [
    { title: "Ask",      url: "/",         icon: SquareTerminal, isActive: true },
    { title: "Library",  url: "/library",  icon: BookOpen },
    { title: "Ingest",   url: "/ingest",   icon: Bot },
    { title: "Settings", url: "/settings", icon: Settings2,
      items: [
        { title: "General", url: "/settings/general" },
        { title: "Retrieval", url: "/settings/retrieval" },
      ] },
  ],
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>{/* brand mark */}</SidebarHeader>
      <SidebarContent><NavMain items={data.navMain} /></SidebarContent>
      <SidebarFooter><NavUser user={data.user} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
```

```tsx
// nav-main.tsx — collapsible sub-menus
import { ChevronRight, type LucideIcon } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export function NavMain({ items }: { items: { title: string; url: string; icon?: LucideIcon; isActive?: boolean; items?: { title: string; url: string }[] }[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible key={item.title} asChild defaultOpen={item.isActive} className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={item.title}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  {item.items && (
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  )}
                </SidebarMenuButton>
              </CollapsibleTrigger>
              {item.items && (
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.title}>
                        <SidebarMenuSubButton asChild><a href={sub.url}>{sub.title}</a></SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              )}
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
```

```tsx
// nav-user.tsx — user dropdown with theme + locale switch (extend for i18n)
import { BadgeCheck, ChevronsUpDown, LogOut } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

export function NavUser({ user }: { user: { name: string; email: string; avatar: string } }) {
  const { isMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuLabel>Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem><BadgeCheck /> Settings</DropdownMenuItem>
              {/* TODO: Locale switcher submenu (EN / Русский) */}
              {/* TODO: Theme switcher submenu (Light / Dark / System) */}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem><LogOut /> Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
```

### skeleton

Loading shimmer placeholder.

```tsx
import { Skeleton } from "@/components/ui/skeleton"

<div className="flex items-center space-x-4">
  <Skeleton className="h-12 w-12 rounded-full" />
  <div className="space-y-2">
    <Skeleton className="h-4 w-[250px]" />
    <Skeleton className="h-4 w-[200px]" />
  </div>
</div>
```

### slider

```tsx
import { Slider } from "@/components/ui/slider"

<Slider defaultValue={[50]} max={100} step={1} className="w-[60%]" />

{/* Range */}
<Slider defaultValue={[20, 80]} max={100} step={1} />
```

### sonner

Toast system. Always-mounted `<Toaster />` plus the `toast(...)` function.

```tsx
// main.tsx
import { Toaster } from "@/components/ui/sonner"
// …
<Toaster />

// anywhere
import { toast } from "sonner"

toast("Event has been created", {
  description: "Sunday, December 03, 2023 at 9:00 AM",
  action: { label: "Undo", onClick: () => console.log("Undo") },
})

toast.success("Saved")
toast.error("Failed", { description: "Network error" })
toast.promise(fn(), { loading: "Saving…", success: "Saved", error: "Failed" })
```

### spinner

Inline loading indicator.

```tsx
import { Spinner } from "@/components/ui/spinner"
<Spinner /> Saving…
```

### switch

Boolean toggle.

```tsx
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

<div className="flex items-center space-x-2">
  <Switch id="airplane-mode" />
  <Label htmlFor="airplane-mode">Airplane Mode</Label>
</div>
```

### table

Two flavors:

**Static (`table-demo`):**

```tsx
import {
  Table, TableBody, TableCaption, TableCell, TableFooter,
  TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

<Table>
  <TableCaption>A list of your recent invoices.</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead className="w-[100px]">Invoice</TableHead>
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {invoices.map((i) => (
      <TableRow key={i.invoice}>
        <TableCell className="font-medium">{i.invoice}</TableCell>
        <TableCell>{i.paymentStatus}</TableCell>
        <TableCell className="text-right">{i.totalAmount}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

**Data-driven with TanStack Table (`data-table-demo`)** — use this for Library and RunHistory. Supports sorting, filtering, column visibility, pagination, row selection out of the box. See the full example at https://ui.shadcn.com/docs/components/data-table.

```tsx
"use client"
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable, type ColumnDef, type SortingState,
  type ColumnFiltersState, type VisibilityState } from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown, MoreHorizontal } from "lucide-react"
// … shadcn Button, Checkbox, DropdownMenu, Input, Table imports

export const columns: ColumnDef<Payment>[] = [
  { id: "select",
    header: ({ table }) => <Checkbox checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")} onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)} />,
    cell: ({ row }) => <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} /> },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <div className="capitalize">{row.getValue("status")}</div> },
  { accessorKey: "email",  header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Email <ArrowUpDown />
      </Button>) },
  { accessorKey: "amount", header: () => <div className="text-right">Amount</div>,
    cell: ({ row }) => <div className="text-right font-medium">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(row.getValue("amount")))}</div> },
  { id: "actions", enableHiding: false, cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem>View details</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>) },
]

const [sorting, setSorting] = React.useState<SortingState>([])
const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
const [rowSelection, setRowSelection] = React.useState({})

const table = useReactTable({
  data, columns,
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  getCoreRowModel: getCoreRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  onColumnVisibilityChange: setColumnVisibility,
  onRowSelectionChange: setRowSelection,
  state: { sorting, columnFilters, columnVisibility, rowSelection },
})

return (
  <div className="w-full">
    <div className="flex items-center py-4">
      <Input placeholder="Filter emails…"
        value={(table.getColumn("email")?.getFilterValue() as string) ?? ""}
        onChange={(e) => table.getColumn("email")?.setFilterValue(e.target.value)}
        className="max-w-sm" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" className="ml-auto">Columns <ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {table.getAllColumns().filter((c) => c.getCanHide()).map((c) => (
            <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)}>
              {c.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => <TableHead key={h.id}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</TableHead>)}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
              {row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    <div className="flex items-center justify-end space-x-2 py-4">
      <div className="flex-1 text-sm text-muted-foreground">
        {table.getFilteredSelectedRowModel().rows.length} of {table.getFilteredRowModel().rows.length} row(s) selected.
      </div>
      <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
      <Button variant="outline" size="sm" onClick={() => table.nextPage()}     disabled={!table.getCanNextPage()}>Next</Button>
    </div>
  </div>
)
```

### tabs

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

<Tabs defaultValue="account">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">
    <Card>
      <CardHeader><CardTitle>Account</CardTitle></CardHeader>
      <CardContent>…</CardContent>
    </Card>
  </TabsContent>
  <TabsContent value="password">
    <Card>…</Card>
  </TabsContent>
</Tabs>
```

### textarea

```tsx
import { Textarea } from "@/components/ui/textarea"
<Textarea placeholder="Type your message here." />
```

### toggle

Single-button toggle (compare to `Switch`).

```tsx
import { Toggle } from "@/components/ui/toggle"
import { Bold } from "lucide-react"
<Toggle aria-label="Toggle bold"><Bold className="h-4 w-4" /></Toggle>
```

### toggle-group

Group of mutually-exclusive (`single`) or multi-select (`multiple`) toggles. Use for view-mode pickers, alignment controls, segmented-control-style choices.

```tsx
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Bold, Italic, Underline } from "lucide-react"

<ToggleGroup type="multiple">
  <ToggleGroupItem value="bold" aria-label="Toggle bold"><Bold className="h-4 w-4" /></ToggleGroupItem>
  <ToggleGroupItem value="italic" aria-label="Toggle italic"><Italic className="h-4 w-4" /></ToggleGroupItem>
  <ToggleGroupItem value="underline" aria-label="Toggle underline"><Underline className="h-4 w-4" /></ToggleGroupItem>
</ToggleGroup>
```

### tooltip

Wrap any trigger in a `Tooltip`. The provider must be mounted once at the root (`<TooltipProvider>` is included by default when you install `tooltip`).

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"

<Tooltip>
  <TooltipTrigger asChild><Button variant="outline">Hover</Button></TooltipTrigger>
  <TooltipContent><p>Add to library</p></TooltipContent>
</Tooltip>
```

---

## 2 · Notes for Claude Design

- **Mocks must compose with these primitives only.** If you need something not in this list (e.g. a kanban board), assemble it from `card` + `dnd-kit` (engineering's call), but flag it explicitly so engineering knows it's bespoke.
- **State classes** like `data-[state=open]`, `aria-invalid`, `group-data-[collapsible=icon]` are handled by Radix + shadcn — designers shouldn't invent new state attributes; just use the variant + class names already shown above.
- **Theming**: shadcn drives colors from CSS variables — `--background`, `--foreground`, `--muted`, `--accent`, `--border`, `--card`, `--popover`, `--primary`, `--destructive`, `--ring`, `--chart-1..5`, `--sidebar-*`. Pick ONE brand accent and override `--primary` in both light and dark themes. Don't introduce hardcoded hex outside the chart palette.
- **Sidebar choice**: `sidebar-07` (collapsible-to-icons + collapsible sub-menus + team switcher + user menu) is the closest match for sovereign-rag's IA. Use it as the layout reference.
- **Forms**: use TanStack Form (preferred — matches our state stack). The `form-tanstack-demo` pattern in the doc is the contract; engineering will port it.
- **Tables**: every multi-row data view uses the **`data-table-demo`** pattern (TanStack Table). Static `table` is only for tiny inline summaries.
- **Mobile**: shadcn `Sheet` is the mobile equivalent of a fixed side panel. `Drawer` is the iOS-style bottom sheet. `CommandDialog` becomes full-screen modal on mobile naturally.

For any component not detailed above (`navigation-menu`, `menubar`, `aspect-ratio`, `item`, `progress`, `radio-group`, `pagination`, `separator`, `scroll-area`, `skeleton`, `spinner`, `kbd`, `field`, `empty`, `textarea`, `toggle`), the canonical docs are at `https://ui.shadcn.com/docs/components/<name>` — Claude Design can fetch any of those pages directly.

              </CollapsibleTrigger>
              {item.items && (
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.title}>
                        <SidebarMenuSubButton asChild><a href={sub.url}>{sub.title}</a></SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              )}
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
```

```tsx
// nav-user.tsx — user dropdown with theme + locale switch (extend for i18n)
import { BadgeCheck, ChevronsUpDown, LogOut } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

export function NavUser({ user }: { user: { name: string; email: string; avatar: string } }) {
  const { isMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuLabel>Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem><BadgeCheck /> Settings</DropdownMenuItem>
              {/* TODO: Locale switcher submenu (EN / Русский) */}
              {/* TODO: Theme switcher submenu (Light / Dark / System) */}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem><LogOut /> Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
```

### skeleton

Loading shimmer placeholder.

```tsx
import { Skeleton } from "@/components/ui/skeleton"

<div className="flex items-center space-x-4">
  <Skeleton className="h-12 w-12 rounded-full" />
  <div className="space-y-2">
    <Skeleton className="h-4 w-[250px]" />
    <Skeleton className="h-4 w-[200px]" />
  </div>
</div>
```

### slider

```tsx
import { Slider } from "@/components/ui/slider"

<Slider defaultValue={[50]} max={100} step={1} className="w-[60%]" />

{/* Range */}
<Slider defaultValue={[20, 80]} max={100} step={1} />
```

### sonner

Toast system. Always-mounted `<Toaster />` plus the `toast(...)` function.

```tsx
// main.tsx
import { Toaster } from "@/components/ui/sonner"
// …
<Toaster />

// anywhere
import { toast } from "sonner"

toast("Event has been created", {
  description: "Sunday, December 03, 2023 at 9:00 AM",
  action: { label: "Undo", onClick: () => console.log("Undo") },
})

toast.success("Saved")
toast.error("Failed", { description: "Network error" })
toast.promise(fn(), { loading: "Saving…", success: "Saved", error: "Failed" })
```

### spinner

Inline loading indicator.

```tsx
import { Spinner } from "@/components/ui/spinner"
<Spinner /> Saving…
```

### switch

Boolean toggle.

```tsx
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

<div className="flex items-center space-x-2">
  <Switch id="airplane-mode" />
  <Label htmlFor="airplane-mode">Airplane Mode</Label>
</div>
```

### table

Two flavors:

**Static (`table-demo`):**

```tsx
import {
  Table, TableBody, TableCaption, TableCell, TableFooter,
  TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

<Table>
  <TableCaption>A list of your recent invoices.</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead className="w-[100px]">Invoice</TableHead>
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {invoices.map((i) => (
      <TableRow key={i.invoice}>
        <TableCell className="font-medium">{i.invoice}</TableCell>
        <TableCell>{i.paymentStatus}</TableCell>
        <TableCell className="text-right">{i.totalAmount}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

**Data-driven with TanStack Table (`data-table-demo`)** — use this for Library and RunHistory. Supports sorting, filtering, column visibility, pagination, row selection out of the box. See the full example at https://ui.shadcn.com/docs/components/data-table.

```tsx
"use client"
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable, type ColumnDef, type SortingState,
  type ColumnFiltersState, type VisibilityState } from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown, MoreHorizontal } from "lucide-react"
// … shadcn Button, Checkbox, DropdownMenu, Input, Table imports

export const columns: ColumnDef<Payment>[] = [
  { id: "select",
    header: ({ table }) => <Checkbox checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")} onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)} />,
    cell: ({ row }) => <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} /> },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <div className="capitalize">{row.getValue("status")}</div> },
  { accessorKey: "email",  header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Email <ArrowUpDown />
      </Button>) },
  { accessorKey: "amount", header: () => <div className="text-right">Amount</div>,
    cell: ({ row }) => <div className="text-right font-medium">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(row.getValue("amount")))}</div> },
  { id: "actions", enableHiding: false, cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem>View details</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>) },
]

const [sorting, setSorting] = React.useState<SortingState>([])
const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
const [rowSelection, setRowSelection] = React.useState({})

const table = useReactTable({
  data, columns,
  onSortingChange: setSorting,
  onColumnFiltersChange: setColumnFilters,
  getCoreRowModel: getCoreRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  onColumnVisibilityChange: setColumnVisibility,
  onRowSelectionChange: setRowSelection,
  state: { sorting, columnFilters, columnVisibility, rowSelection },
})

return (
  <div className="w-full">
    <div className="flex items-center py-4">
      <Input placeholder="Filter emails…"
        value={(table.getColumn("email")?.getFilterValue() as string) ?? ""}
        onChange={(e) => table.getColumn("email")?.setFilterValue(e.target.value)}
        className="max-w-sm" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" className="ml-auto">Columns <ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {table.getAllColumns().filter((c) => c.getCanHide()).map((c) => (
            <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)}>
              {c.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => <TableHead key={h.id}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</TableHead>)}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
              {row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    <div className="flex items-center justify-end space-x-2 py-4">
      <div className="flex-1 text-sm text-muted-foreground">
        {table.getFilteredSelectedRowModel().rows.length} of {table.getFilteredRowModel().rows.length} row(s) selected.
      </div>
      <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
      <Button variant="outline" size="sm" onClick={() => table.nextPage()}     disabled={!table.getCanNextPage()}>Next</Button>
    </div>
  </div>
)
```

### tabs

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

<Tabs defaultValue="account">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">
    <Card>
      <CardHeader><CardTitle>Account</CardTitle></CardHeader>
      <CardContent>…</CardContent>
    </Card>
  </TabsContent>
  <TabsContent value="password">
    <Card>…</Card>
  </TabsContent>
</Tabs>
```

### textarea

```tsx
import { Textarea } from "@/components/ui/textarea"
<Textarea placeholder="Type your message here." />
```

### toggle

Single-button toggle (compare to `Switch`).

```tsx
import { Toggle } from "@/components/ui/toggle"
import { Bold } from "lucide-react"
<Toggle aria-label="Toggle bold"><Bold className="h-4 w-4" /></Toggle>
```

### toggle-group

Group of mutually-exclusive (`single`) or multi-select (`multiple`) toggles. Use for view-mode pickers, alignment controls, segmented-control-style choices.

```tsx
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Bold, Italic, Underline } from "lucide-react"

<ToggleGroup type="multiple">
  <ToggleGroupItem value="bold" aria-label="Toggle bold"><Bold className="h-4 w-4" /></ToggleGroupItem>
  <ToggleGroupItem value="italic" aria-label="Toggle italic"><Italic className="h-4 w-4" /></ToggleGroupItem>
  <ToggleGroupItem value="underline" aria-label="Toggle underline"><Underline className="h-4 w-4" /></ToggleGroupItem>
</ToggleGroup>
```

### tooltip

Wrap any trigger in a `Tooltip`. The provider must be mounted once at the root (`<TooltipProvider>` is included by default when you install `tooltip`).

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"

<Tooltip>
  <TooltipTrigger asChild><Button variant="outline">Hover</Button></TooltipTrigger>
  <TooltipContent><p>Add to library</p></TooltipContent>
</Tooltip>
```

---

## 2 · Notes for Claude Design

- **Mocks must compose with these primitives only.** If you need something not in this list (e.g. a kanban board), assemble it from `card` + `dnd-kit` (engineering's call), but flag it explicitly so engineering knows it's bespoke.
- **State classes** like `data-[state=open]`, `aria-invalid`, `group-data-[collapsible=icon]` are handled by Radix + shadcn — designers shouldn't invent new state attributes; just use the variant + class names already shown above.
- **Theming**: shadcn drives colors from CSS variables — `--background`, `--foreground`, `--muted`, `--accent`, `--border`, `--card`, `--popover`, `--primary`, `--destructive`, `--ring`, `--chart-1..5`, `--sidebar-*`. Pick ONE brand accent and override `--primary` in both light and dark themes. Don't introduce hardcoded hex outside the chart palette.
- **Sidebar choice**: `sidebar-07` (collapsible-to-icons + collapsible sub-menus + team switcher + user menu) is the closest match for sovereign-rag's IA. Use it as the layout reference.
- **Forms**: use TanStack Form (preferred — matches our state stack). The `form-tanstack-demo` pattern in the doc is the contract; engineering will port it.
- **Tables**: every multi-row data view uses the **`data-table-demo`** pattern (TanStack Table). Static `table` is only for tiny inline summaries.
- **Mobile**: shadcn `Sheet` is the mobile equivalent of a fixed side panel. `Drawer` is the iOS-style bottom sheet. `CommandDialog` becomes full-screen modal on mobile naturally.

For any component not detailed above (`navigation-menu`, `menubar`, `aspect-ratio`, `item`, `progress`, `radio-group`, `pagination`, `separator`, `scroll-area`, `skeleton`, `spinner`, `kbd`, `field`, `empty`, `textarea`, `toggle`), the canonical docs are at `https://ui.shadcn.com/docs/components/<name>` — Claude Design can fetch any of those pages directly.
