// native_switch — embeds real macOS NSSwitch controls into Electron windows.
//
// N-API addon, ABI-stable across Node/Electron versions. macOS only.
// All functions must be called on the main thread (ipcMain handlers qualify).
//
// API:
//   create(id, windowHandle, props, onChange)  — props: {x,y,width,height,on,enabled,visible,appearance,monochrome}
//   update(id, props)                          — same props, all optional after creation
//   destroy(id)
//   destroyAll()
//   details(id)                                — {naturalWidth,naturalHeight,on,backingScaleFactor}
//
// monochrome modes (CIFilter chains on the switch layer):
//   0 = none (native accent color)
//   1 = grayscale only
//   2 = grayscale + contrast/brightness  → black track / white knob (light theme ON)
//   3 = grayscale + invert + contrast    → white track / black knob (dark theme ON)

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#include <napi.h>

@interface NativeSwitch : NSSwitch
@end

@interface NSSwitchActionTarget : NSObject
@property(nonatomic, assign) NSInteger switchId;
- (void)didChange:(NSSwitch*)sender;
@end

static NSMutableDictionary<NSNumber*, NSMutableDictionary*>* registry = nil;

static NSMutableDictionary* RecordFor(NSInteger sid) {
  return registry ? registry[@(sid)] : nil;
}

static void EmitChange(NSInteger sid, BOOL on) {
  NSMutableDictionary* rec = RecordFor(sid);
  if (!rec) return;
  Napi::FunctionReference* cb = (Napi::FunctionReference*)[[rec objectForKey:@"cbPtr"] pointerValue];
  if (!cb || cb->IsEmpty()) return;
  Napi::Env env = cb->Env();
  Napi::HandleScope scope(env);
  cb->Call({Napi::Boolean::New(env, on)});
}

@implementation NSSwitchActionTarget
- (void)didChange:(NSSwitch*)sender {
  EmitChange(self.switchId, sender.state == NSControlStateValueOn);
}
@end

@implementation NativeSwitch
- (BOOL)acceptsFirstResponder { return NO; }
- (BOOL)canBecomeKeyView { return NO; }
- (BOOL)isAccessibilityElement { return NO; }
- (NSArray*)accessibilityChildren { return @[]; }
- (id)accessibilityHitTest:(NSPoint)point { return nil; }
@end

static NSRect FrameForRect(NSView* parent, NSSwitch* sw, const Napi::Object& rect) {
  [sw sizeToFit];
  const NSSize size = sw.frame.size;
  const double x = rect.Get("x").As<Napi::Number>().DoubleValue();
  const double y = rect.Get("y").As<Napi::Number>().DoubleValue();
  const double width = rect.Get("width").As<Napi::Number>().DoubleValue();
  const double height = rect.Get("height").As<Napi::Number>().DoubleValue();
  return NSMakeRect(x + (width - size.width) / 2,
                    parent.bounds.size.height - y - height + (height - size.height) / 2,
                    size.width, size.height);
}

static void ApplyMonochrome(NSSwitch* sw, int mode) {
  sw.wantsLayer = YES;
  if (mode <= 0) { sw.layer.filters = nil; return; }
  CIFilter* gray = [CIFilter filterWithName:@"CIColorControls"];
  [gray setDefaults];
  [gray setValue:@0.0 forKey:@"inputSaturation"];
  NSMutableArray* filters = [NSMutableArray arrayWithObject:gray];
  if (mode == 2) {
    CIFilter* boost = [CIFilter filterWithName:@"CIColorControls"];
    [boost setDefaults];
    [boost setValue:@0.0 forKey:@"inputSaturation"];
    [boost setValue:@2.4 forKey:@"inputContrast"];
    [boost setValue:@-0.28 forKey:@"inputBrightness"];
    [filters addObject:boost];
  }
  if (mode == 3) {
    CIFilter* inv = [CIFilter filterWithName:@"CIColorMatrix"];
    [inv setDefaults];
    [inv setValue:[CIVector vectorWithX:-1 Y:0 Z:0 W:0] forKey:@"inputRVector"];
    [inv setValue:[CIVector vectorWithX:0 Y:-1 Z:0 W:0] forKey:@"inputGVector"];
    [inv setValue:[CIVector vectorWithX:0 Y:0 Z:-1 W:0] forKey:@"inputBVector"];
    [inv setValue:[CIVector vectorWithX:1 Y:1 Z:1 W:0] forKey:@"inputBiasVector"];
    [filters addObject:inv];
    CIFilter* boost = [CIFilter filterWithName:@"CIColorControls"];
    [boost setDefaults];
    [boost setValue:@0.0 forKey:@"inputSaturation"];
    [boost setValue:@2.0 forKey:@"inputContrast"];
    [boost setValue:@0.18 forKey:@"inputBrightness"];
    [filters addObject:boost];
  }
  sw.layer.filters = filters;
}

static void ApplyProps(NSSwitch* sw, const Napi::Object& props) {
  // Appearance and monochrome first — they do not affect geometry.
  if (props.Has("appearance")) {
    const std::string appearance = props.Get("appearance").As<Napi::String>().Utf8Value();
    if (appearance == "light") {
      sw.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
    } else if (appearance == "dark") {
      sw.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    } else {
      sw.appearance = nil;
    }
  }
  if (props.Has("monochrome")) {
    ApplyMonochrome(sw, props.Get("monochrome").As<Napi::Number>().Int32Value());
  }
  if (props.Has("x")) {
    sw.frame = FrameForRect(sw.superview, sw, props);
  }
  if (props.Has("visible")) sw.hidden = !props.Get("visible").As<Napi::Boolean>().Value();
  if (props.Has("enabled")) sw.enabled = props.Get("enabled").As<Napi::Boolean>().Value();
  if (props.Has("on")) {
    sw.state = props.Get("on").As<Napi::Boolean>().Value() ? NSControlStateValueOn : NSControlStateValueOff;
  }
}

Napi::Value Create(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!registry) registry = [NSMutableDictionary new];
  if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsBuffer() || !info[2].IsObject() || !info[3].IsFunction()) {
    throw Napi::TypeError::New(env, "Expected id, window handle, props, change callback");
  }
  const NSInteger sid = info[0].As<Napi::Number>().Int64Value();
  if (RecordFor(sid)) throw Napi::Error::New(env, "Switch id already exists");

  const auto handle = info[1].As<Napi::Buffer<uint8_t>>();
  if (handle.Length() < sizeof(NSView*)) throw Napi::TypeError::New(env, "Invalid window handle");
  void* rawParent = *reinterpret_cast<void**>(handle.Data());
  NSView* parent = (__bridge NSView*)rawParent;
  if (!parent || !parent.window) throw Napi::Error::New(env, "Handle does not reference a live NSView");

  NSSwitch* sw = [[NativeSwitch alloc] initWithFrame:NSZeroRect];
  sw.controlSize = NSControlSizeSmall; // natural size 44x20 in-window
  NSSwitchActionTarget* target = [NSSwitchActionTarget new];
  target.switchId = sid;
  sw.target = target;
  sw.action = @selector(didChange:);
  [parent addSubview:sw positioned:NSWindowAbove relativeTo:nil];

  NSMutableDictionary* rec = [NSMutableDictionary new];
  rec[@"view"] = sw;
  rec[@"target"] = target;
  Napi::FunctionReference* cb = new Napi::FunctionReference();
  *cb = Napi::Persistent(info[3].As<Napi::Function>());
  rec[@"cbPtr"] = [NSValue valueWithPointer:cb];
  registry[@(sid)] = rec;

  ApplyProps(sw, info[2].As<Napi::Object>());
  return Napi::Boolean::New(env, true);
}

Napi::Value Update(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const NSInteger sid = info[0].As<Napi::Number>().Int64Value();
  NSMutableDictionary* rec = RecordFor(sid);
  if (!rec) return Napi::Boolean::New(env, false);
  ApplyProps(rec[@"view"], info[1].As<Napi::Object>());
  return Napi::Boolean::New(env, true);
}

void Destroy(const Napi::CallbackInfo& info) {
  const NSInteger sid = info[0].As<Napi::Number>().Int64Value();
  NSMutableDictionary* rec = RecordFor(sid);
  if (!rec) return;
  NSSwitch* sw = rec[@"view"];
  [sw removeFromSuperview];
  Napi::FunctionReference* cb = (Napi::FunctionReference*)[[rec objectForKey:@"cbPtr"] pointerValue];
  if (cb) { cb->Reset(); delete cb; }
  [registry removeObjectForKey:@(sid)];
}

void DestroyAll(const Napi::CallbackInfo&) {
  if (!registry) return;
  for (NSNumber* key in [[registry copy] allKeys]) {
    NSMutableDictionary* rec = registry[key];
    [(NSSwitch*)rec[@"view"] removeFromSuperview];
    Napi::FunctionReference* cb = (Napi::FunctionReference*)[[rec objectForKey:@"cbPtr"] pointerValue];
    if (cb) { cb->Reset(); delete cb; }
  }
  [registry removeAllObjects];
}

Napi::Value Details(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);
  const NSInteger sid = info[0].As<Napi::Number>().Int64Value();
  NSMutableDictionary* rec = RecordFor(sid);
  if (!rec) return result;
  NSSwitch* sw = rec[@"view"];
  [sw sizeToFit];
  result.Set("naturalWidth", sw.frame.size.width);
  result.Set("naturalHeight", sw.frame.size.height);
  result.Set("on", sw.state == NSControlStateValueOn);
  result.Set("backingScaleFactor", sw.window.backingScaleFactor);
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("create", Napi::Function::New(env, Create));
  exports.Set("update", Napi::Function::New(env, Update));
  exports.Set("destroy", Napi::Function::New(env, Destroy));
  exports.Set("destroyAll", Napi::Function::New(env, DestroyAll));
  exports.Set("details", Napi::Function::New(env, Details));
  return exports;
}

NODE_API_MODULE(native_switch, Init)
