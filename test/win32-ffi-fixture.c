// ABI fixture, not a Win32 implementation. Checks actual Koffi pointer/callback/output marshalling.
#include <stdint.h>
#include <string.h>
int EnumWindows(int (*callback)(void *, intptr_t), intptr_t param) {
  return callback((void *)0x101, param) && callback((void *)0x102, param);
}
uint32_t GetWindowThreadProcessId(void *window, uint32_t *pid) {
  *pid = window == (void *)0x101 ? 42 : 99;
  return 7;
}
int GetClassNameW(void *window, uint16_t *name, int count) {
  const char *text = "Chrome_WidgetWin_1";
  int length = strlen(text);
  for (int i = 0; i <= length && i < count; i++) name[i] = text[i];
  return length;
}
int IsWindowVisible(void *window) { return 1; }
int IsIconic(void *window) { return 0; }
void *GetWindow(void *window, uint32_t command) { return 0; }
int GetWindowRect(void *window, int32_t *rect) { return 0; }
int32_t DwmGetWindowAttribute(void *window, uint32_t attr, void *value, uint32_t size) {
  if (attr == 9 && size == 16) {
    int32_t rect[4] = {-1200, 450, 0, 1350};
    memcpy(value, rect, 16);
    return 0;
  }
  if (attr == 14 && size == 4) { *(uint32_t *)value = 0; return 0; }
  return -1;
}
intptr_t SetThreadDpiAwarenessContext(intptr_t context) { return -4; }
// Added for the all-windows lister (0.5.8): window 0x101 is titled, 0x102 is an untitled tool window.
int IsWindow(void *window) { return window == (void *)0x101 || window == (void *)0x102; }
int GetWindowTextLengthW(void *window) { return window == (void *)0x101 ? 5 : 0; }
intptr_t GetWindowLongPtrW(void *window, int index) { return index == -20 && window == (void *)0x102 ? 0x80 : 0; }
