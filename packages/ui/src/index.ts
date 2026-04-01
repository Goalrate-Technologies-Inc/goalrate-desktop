// @goalrate-app/ui
// Shared React component library for Goalrate applications

// Utility exports
export { cn } from './utils';

// Primitive components
export {
  Button,
  buttonVariants,
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
  Textarea,
  Checkbox,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
  Label,
  Separator,
  type ButtonProps,
  type CardProps,
  type InputProps,
  type TextareaProps,
} from './primitives';

// Overlay components
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './overlay';

// Feedback components
export {
  Badge,
  badgeVariants,
  CompletionRing,
  Progress,
  Skeleton,
  Alert,
  AlertTitle,
  AlertDescription,
  Toaster,
  toast,
  type BadgeProps,
  type CompletionRingProps,
} from './feedback';

// Data display components
export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AVATAR_SIZES,
  ScrollArea,
  ScrollBar,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  type AvatarSize,
  type AvatarProps,
  type AvatarFallbackProps,
} from './data-display';

// Navigation components
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from './navigation';

// Form components
export {
  FormField,
  FormActions,
  type FormFieldProps,
  type FormActionsProps,
} from './forms';

// Layout components
export {
  PageHeader,
  ContentCard,
  MetricCard,
  type PageHeaderProps,
  type ContentCardProps,
  type MetricCardProps,
} from './layout';

// Kanban components
export {
  KanbanBoard,
  KanbanColumn,
  KanbanCard,
  type KanbanBoardProps,
  type KanbanColumnProps,
  type KanbanCardProps,
} from './kanban';

// Brand components
export { Logo, LogoIcon, LogoMark } from './brand';

// Focus components
export {
  TodaysFocus,
  FocusItemCard,
  FocusProgress,
  FocusEmptyState,
  FocusItemActions,
  // Velocity tracking components
  VelocityStats,
  VelocityTrendChart,
  VelocityCard,
  type TodaysFocusProps,
  type FocusItemCardProps,
  type FocusProgressProps,
  type FocusEmptyStateProps,
  type FocusItemActionsProps,
  type FocusEmptyStateType,
  // Velocity types
  type VelocityStatsProps,
  type VelocityTrendChartProps,
  type VelocityCardProps,
} from './focus';

// Sync components
export {
  SyncStatusBadge,
  syncStatusBadgeVariants,
  SyncErrorToast,
  type SyncStatusBadgeProps,
  type SyncErrorToastProps,
} from './sync';

// Presence components
export {
  PresenceIndicator,
  presenceIndicatorVariants,
  STATUS_COLORS,
  STATUS_LABELS,
  PresenceBadge,
  UserPresenceRow,
  OnlineUsersList,
  EntityViewers,
  EntityEditors,
  type PresenceIndicatorProps,
  type PresenceStatus,
  type PresenceBadgeProps,
  type UserPresenceData,
  type UserPresenceRowProps,
  type OnlineUsersListProps,
  type EntityViewersProps,
  type EntityViewerData,
  type EntityEditorsProps,
  type EntityEditorData,
} from './presence';

// Brand components

// Theme components
export {
  ThemeProvider,
  useTheme,
  useResolvedTheme,
  type ResolvedTheme,
} from './theme';

// Design tokens
export {
  // Color palettes
  purple,
  blue,
  orange,
  yellow,
  green,
  gray,
  red,
  white,
  black,
  // Semantic colors
  COLORS,
  // Tailwind exports
  tailwindColors,
  // Utility functions
  getContextColor,
  getProgressColor,
  // Spacing system
  spacing,
  COMPONENT_SPACING,
  typography,
  radius,
  type SpacingKey,
  type ComponentSpacingKey,
} from './styles';
