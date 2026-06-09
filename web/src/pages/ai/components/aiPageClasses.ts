export const buttonType = `button` as const;
export const ghostButtonVariant = `ghost` as const;
export const iconButtonSize = `icon` as const;

export const statusBlockClasses = {
  actions: `flex min-w-0 items-center justify-end gap-1.5`,
  statusText: `text-info flex min-w-0 items-center justify-end gap-2 text-right text-xs font-light`,
  statusLoader: `size-3 shrink-0 animate-spin`,
  statusRefresh: `hover:text-foreground min-w-0 cursor-pointer truncate text-left duration-200 hover:opacity-60`,
  truncate: `min-w-0 truncate`,
  settingsButton: `size-7 shrink-0`,
  settingsIcon: `size-4`,
};
