package dev.shapeshifter.sample

import android.os.Bundle
import android.widget.ImageView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val image = ImageView(this)
        image.setImageResource(R.drawable.nested_clip_vector)
        image.contentDescription = "ShapeShifter exported VectorDrawable"
        setContentView(image)
    }
}
