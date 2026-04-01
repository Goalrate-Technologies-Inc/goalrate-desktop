# @goalrate-app/ui

React component library for Goalrate web applications. Built with Radix UI primitives, Tailwind CSS, and a custom design system with purple (goals) and blue (projects) theming.

## Features

- **Accessible**: Built on Radix UI primitives with full ARIA support
- **Themeable**: Custom color palettes for goals (purple) and projects (blue)
- **Composable**: Modular components with subpath exports
- **Drag & Drop**: Kanban boards with dnd-kit
- **Real-time**: Presence indicators and sync status components

## Installation

This package is part of the Goalrate monorepo and is automatically available to other workspace packages.

```json
{
  "dependencies": {
    "@goalrate-app/ui": "workspace:*"
  }
}
```

### Peer Dependencies

```json
"react": "^18.0.0 || ^19.0.0",
"react-dom": "^18.0.0 || ^19.0.0"
```

### CSS Setup

Import the global styles in your app entry:

```typescript
import '@goalrate-app/ui/styles/globals.css';
```

## Quick Start

```typescript
import { Button, Card, CardHeader, CardTitle, CardContent } from '@goalrate-app/ui';

function MyComponent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Goal</CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant="goals">Complete Task</Button>
      </CardContent>
    </Card>
  );
}
```

## API Reference

### Primitives

Core building blocks for forms and interactions.

```typescript
import {
  Button,
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Input,
  Textarea,
  Checkbox,
  RadioGroup, RadioGroupItem,
  Switch,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Label,
  Separator,
} from '@goalrate-app/ui/primitives';

// Button variants
<Button variant="default">Default</Button>
<Button variant="goals">Goals (Purple)</Button>
<Button variant="projects">Projects (Blue)</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Button sizes
<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>
<Button size="icon"><Icon /></Button>

// Card with context color
<Card className="border-l-4 border-purple-600">
  <CardHeader>
    <CardTitle>Goal Title</CardTitle>
    <CardDescription>Optional description</CardDescription>
  </CardHeader>
  <CardContent>Content here</CardContent>
  <CardFooter>Footer actions</CardFooter>
</Card>

// Form inputs
<Input placeholder="Enter text" />
<Input type="email" error="Invalid email" />
<Textarea rows={4} placeholder="Description" />
<Checkbox checked={checked} onCheckedChange={setChecked} />
<Switch checked={enabled} onCheckedChange={setEnabled} />

// Select dropdown
<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Select option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="a">Option A</SelectItem>
    <SelectItem value="b">Option B</SelectItem>
  </SelectContent>
</Select>
```

### Overlay Components

Modals, popovers, and menus.

```typescript
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  Popover, PopoverTrigger, PopoverContent,
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@goalrate-app/ui/overlay';

// Dialog
<Dialog>
  <DialogTrigger asChild>
    <Button>Open Dialog</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit Goal</DialogTitle>
      <DialogDescription>Make changes to your goal.</DialogDescription>
    </DialogHeader>
    {/* form content */}
    <DialogFooter>
      <Button>Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

// Alert Dialog (confirmation)
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Delete</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogCancel>Cancel</AlertDialogCancel>
    <AlertDialogAction>Delete</AlertDialogAction>
  </AlertDialogContent>
</AlertDialog>

// Dropdown Menu
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost"><MoreIcon /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={handleEdit}>Edit</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

// Tooltip (requires TooltipProvider at root)
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button size="icon"><HelpIcon /></Button>
    </TooltipTrigger>
    <TooltipContent>Helpful information</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

### Feedback Components

Status indicators and notifications.

```typescript
import {
  Badge, badgeVariants,
  Progress,
  Skeleton,
  Alert, AlertTitle, AlertDescription,
  Toaster, toast,
} from '@goalrate-app/ui/feedback';

// Badge variants
<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Error</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="success">Success</Badge>
<Badge variant="warning">Warning</Badge>

// Progress bar
<Progress value={75} className="h-2" />
<Progress value={45} variant="goals" /> {/* Purple */}
<Progress value={60} variant="projects" /> {/* Blue */}

// Skeleton loading
<Skeleton className="h-12 w-full" />
<Skeleton className="h-4 w-[200px]" />

// Alert
<Alert>
  <AlertTitle>Heads up!</AlertTitle>
  <AlertDescription>Something to know about.</AlertDescription>
</Alert>
<Alert variant="destructive">
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>

// Toast notifications
<Toaster /> {/* Add to app root */}

// Trigger toasts
toast('Event created');
toast.success('Goal completed!');
toast.error('Failed to save');
toast.loading('Saving...');
```

### Data Display

Components for showing information.

```typescript
import {
  Avatar, AvatarImage, AvatarFallback, AVATAR_SIZES,
  ScrollArea, ScrollBar,
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from '@goalrate-app/ui/data-display';

// Avatar
<Avatar size="md">
  <AvatarImage src={user.avatarUrl} alt={user.name} />
  <AvatarFallback>{user.initials}</AvatarFallback>
</Avatar>

// Avatar sizes: 'xs' | 'sm' | 'md' | 'lg' | 'xl'

// Scroll area
<ScrollArea className="h-[300px]">
  {/* Long content */}
  <ScrollBar orientation="vertical" />
</ScrollArea>

// Accordion
<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>Section 1</AccordionTrigger>
    <AccordionContent>Content for section 1</AccordionContent>
  </AccordionItem>
</Accordion>
```

### Navigation

Tabs and breadcrumbs.

```typescript
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator,
} from '@goalrate-app/ui/navigation';

// Tabs
<Tabs defaultValue="overview">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="tasks">Tasks</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">Overview content</TabsContent>
  <TabsContent value="tasks">Tasks content</TabsContent>
</Tabs>

// Breadcrumb
<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink href="/">Home</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>Current Page</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

### Forms

Form layout helpers.

```typescript
import { FormField, FormActions } from '@goalrate-app/ui/forms';

// Form field with label and error
<FormField label="Goal Title" error={errors.title} required>
  <Input {...register('title')} />
</FormField>

// Form actions (submit/cancel buttons)
<FormActions>
  <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
  <Button type="submit">Save</Button>
</FormActions>
```

### Layout

Page structure components.

```typescript
import { PageHeader, ContentCard, MetricCard } from '@goalrate-app/ui/layout';

// Page header
<PageHeader
  title="Goals"
  description="Track your SMART goals"
  actions={<Button>New Goal</Button>}
/>

// Content card
<ContentCard title="Recent Activity" description="Your latest updates">
  {/* content */}
</ContentCard>

// Metric card
<MetricCard
  title="Completion Rate"
  value="87%"
  trend="+5%"
  trendDirection="up"
  icon={<ChartIcon />}
/>
```

### Kanban Board

Drag-and-drop board components.

```typescript
import { KanbanBoard, KanbanColumn, KanbanCard } from '@goalrate-app/ui/kanban';

<KanbanBoard
  columns={columns}
  onDragEnd={handleDragEnd}
>
  {columns.map((column) => (
    <KanbanColumn
      key={column.id}
      id={column.id}
      title={column.name}
      count={column.items.length}
    >
      {column.items.map((item) => (
        <KanbanCard
          key={item.id}
          id={item.id}
          title={item.title}
          tags={item.tags}
          priority={item.priority}
          assignee={item.assignee}
          points={item.points}
          onClick={() => openItem(item)}
        />
      ))}
    </KanbanColumn>
  ))}
</KanbanBoard>
```

### Focus Components

Today's Focus feature components.

```typescript
import {
  TodaysFocus,
  FocusItemCard,
  FocusProgress,
  FocusEmptyState,
  FocusItemActions,
  VelocityStats,
  VelocityTrendChart,
  VelocityCard,
} from '@goalrate-app/ui/focus';

// Main focus view
<TodaysFocus
  items={focusItems}
  completedPoints={12}
  totalPoints={18}
  onComplete={handleComplete}
  onDefer={handleDefer}
  showSummary={false}
  onShowSummary={() => setShowSummary(true)}
/>

// Individual focus item
<FocusItemCard
  item={item}
  onComplete={() => complete(item.id)}
  onDefer={(date) => defer(item.id, date)}
/>

// Progress indicator
<FocusProgress
  completed={12}
  total={18}
  variant="ring" // or "bar"
/>

// Empty state
<FocusEmptyState
  type="no-items" // | "all-completed" | "not-generated"
  onGenerate={generateFocus}
/>

// Velocity tracking
<VelocityStats
  averagePoints={15.5}
  currentStreak={7}
  completionRate={0.85}
/>

<VelocityTrendChart data={weeklyData} />

<VelocityCard velocity={velocityData} />
```

### Presence Components

Real-time collaboration indicators.

```typescript
import {
  PresenceIndicator,
  PresenceBadge,
  UserPresenceRow,
  OnlineUsersList,
  EntityViewers,
  EntityEditors,
} from '@goalrate-app/ui/presence';

// Status dot
<PresenceIndicator status="online" size="sm" />
<PresenceIndicator status="away" animated />
<PresenceIndicator status="busy" />
<PresenceIndicator status="offline" />

// Avatar with status
<PresenceBadge
  user={{ userId: '1', username: 'Alice', avatarUrl: '...', status: 'online' }}
  size="md"
  showName
/>

// User list item
<UserPresenceRow
  user={user}
  showActivity
  onMessage={() => openChat(user.id)}
/>

// Online users panel
<OnlineUsersList
  users={onlineUsers}
  currentUserId={me.id}
  maxVisible={5}
  onUserClick={(userId) => viewProfile(userId)}
  onMessage={(userId) => openChat(userId)}
/>

// Entity viewers (who's looking)
<EntityViewers
  viewers={viewerList}
  maxVisible={3}
  showLabel
/>

// Entity editors (who's editing)
<EntityEditors
  editors={editorList}
  highlightedField="title"
  variant="warning"
/>
```

### Sync Components

Sync status and conflict UI.

```typescript
import { SyncStatusBadge, SyncErrorToast } from '@goalrate-app/ui/sync';

// Sync status badge
<SyncStatusBadge status="synced" />
<SyncStatusBadge status="syncing" showSpinner />
<SyncStatusBadge status="pending" count={3} />
<SyncStatusBadge status="error" message="Network unavailable" />
<SyncStatusBadge status="offline" />

// Sync error toast
<SyncErrorToast
  error={syncError}
  onRetry={retrySyncL}
  onDismiss={dismissError}
/>
```

### Design Tokens

Color palettes and spacing.

```typescript
import {
  // Color palettes
  purple, blue, orange, yellow, green, gray, red,
  // Semantic colors
  COLORS,
  // Tailwind colors export
  tailwindColors,
  // Utility functions
  getContextColor,
  getProgressColor,
  // Spacing
  spacing,
  COMPONENT_SPACING,
  typography,
  radius,
} from '@goalrate-app/ui/styles';

// Color palettes
purple[600] // '#61019E' - Primary goal color
blue[600]   // '#015E9E' - Primary project color

// Semantic colors
COLORS.goals.primary    // purple[600]
COLORS.projects.primary // blue[600]
COLORS.success          // green[600]
COLORS.warning          // yellow[600]
COLORS.danger           // red[600]

// Context-aware color
const color = getContextColor('goals'); // Returns purple palette
const color = getContextColor('projects'); // Returns blue palette

// Progress color based on percentage
const color = getProgressColor(85); // green
const color = getProgressColor(60); // yellow
const color = getProgressColor(30); // red
```

### Utility Functions

```typescript
import { cn } from '@goalrate-app/ui/utils';

// Merge class names (Tailwind merge)
<div className={cn('base-class', conditional && 'conditional-class', className)} />
```

## Package Structure

```
src/
├── index.ts              # All exports
├── primitives/           # Button, Card, Input, etc.
├── overlay/              # Dialog, Dropdown, Popover, Tooltip
├── feedback/             # Badge, Progress, Skeleton, Alert, Toast
├── data-display/         # Avatar, ScrollArea, Accordion
├── navigation/           # Tabs, Breadcrumb
├── forms/                # FormField, FormActions
├── layout/               # PageHeader, ContentCard, MetricCard
├── kanban/               # KanbanBoard, KanbanColumn, KanbanCard
├── focus/                # TodaysFocus, VelocityStats, etc.
├── presence/             # PresenceIndicator, OnlineUsersList, etc.
├── sync/                 # SyncStatusBadge, SyncErrorToast
├── styles/               # Color tokens, spacing, globals.css
└── utils/                # cn() and other utilities
```

## Dependencies

- `@goalrate-app/shared` - Type definitions
- `@goalrate-app/tailwind-config` - Tailwind configuration
- `@radix-ui/*` - Accessible UI primitives
- `@dnd-kit/*` - Drag and drop
- `lucide-react` - Icons
- `sonner` - Toast notifications
- `class-variance-authority` - Component variants
- `tailwind-merge` - Class name merging

## Exports

| Path | Description |
|------|-------------|
| `@goalrate-app/ui` | All components |
| `@goalrate-app/ui/primitives` | Core form components |
| `@goalrate-app/ui/overlay` | Modals and popovers |
| `@goalrate-app/ui/feedback` | Status indicators |
| `@goalrate-app/ui/data-display` | Data presentation |
| `@goalrate-app/ui/navigation` | Tabs and breadcrumbs |
| `@goalrate-app/ui/forms` | Form helpers |
| `@goalrate-app/ui/layout` | Page structure |
| `@goalrate-app/ui/kanban` | Drag-drop board |
| `@goalrate-app/ui/focus` | Today's Focus |
| `@goalrate-app/ui/presence` | Collaboration |
| `@goalrate-app/ui/sync` | Sync status |
| `@goalrate-app/ui/styles` | Design tokens |
| `@goalrate-app/ui/utils` | Utilities |

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## Design System

### Color Palette

- **Goals**: Purple (`#61019E`) - Used for goal-related UI
- **Projects**: Blue (`#015E9E`) - Used for project-related UI
- **Success**: Green - Completion, positive states
- **Warning**: Yellow/Orange - Attention needed
- **Danger**: Red - Errors, destructive actions
- **Neutral**: Gray - Borders, disabled states

### Spacing Scale

Based on 4px grid: `xs: 4px`, `sm: 8px`, `md: 16px`, `lg: 24px`, `xl: 32px`, `2xl: 48px`

### Typography

- **Headings**: Inter font, semibold
- **Body**: Inter font, regular
- **Code**: JetBrains Mono

## Related Packages

- `@goalrate-app/shared` - Type definitions
- `@goalrate-app/tailwind-config` - Shared Tailwind config
- `@goalrate-app/ui-native` - React Native counterpart
- `@goalrate-app/websocket` - Presence hooks used by components
