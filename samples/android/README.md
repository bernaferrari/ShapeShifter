# Sample Android app

Minimal app that displays a VectorDrawable produced by ShapeShifter (`app/src/main/res/drawable/nested_clip_vector.xml`).

```bash
# from this directory, with Android SDK + Gradle installed
gradle :app:assembleDebug
```

Or compile just the drawable:

```bash
aapt2 compile -o /tmp/sample.zip app/src/main/res/drawable/nested_clip_vector.xml
```

Replace that XML with an export from the editor (`Export → Vector XML` or unzip an AVD into `res/`).
