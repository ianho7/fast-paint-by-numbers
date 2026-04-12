use crate::contours::ContourLoop;
use crate::models::LabelBounds;
use crate::regions::{flat_index, Facet};

pub fn render_indexed_pixels_rgba(
    width: u32,
    height: u32,
    indexed_pixels: &[usize],
    palette: &[[u8; 3]],
) -> Vec<u8> {
    let mut rgba = vec![255u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        for x in 0..width {
            let pixel_index = flat_index(width, x, y);
            let color = palette.get(indexed_pixels[pixel_index]).copied().unwrap_or([255, 255, 255]);
            let offset = pixel_index * 4;
            rgba[offset] = color[0];
            rgba[offset + 1] = color[1];
            rgba[offset + 2] = color[2];
            rgba[offset + 3] = 255;
        }
    }
    rgba
}

pub fn render_border_paths_rgba(
    width: u32,
    height: u32,
    facets: &[Facet],
    loops_by_facet: &[Vec<ContourLoop>],
    palette: &[[u8; 3]],
) -> Vec<u8> {
    let mut rgba = render_facets_with_border_points(width, height, facets, palette);
    for loops in loops_by_facet {
        for loop_item in loops {
            draw_loop_polyline(&mut rgba, width, height, &loop_item.points, [17, 17, 17, 255]);
        }
    }
    rgba
}

pub fn render_label_placement_rgba(
    width: u32,
    height: u32,
    facets: &[Facet],
    loops_by_facet: &[Vec<ContourLoop>],
    label_bounds: &[LabelBounds],
    palette: &[[u8; 3]],
) -> Vec<u8> {
    let mut rgba = render_border_paths_rgba(width, height, facets, loops_by_facet, palette);
    for bounds in label_bounds {
        draw_label_rect(&mut rgba, width, height, bounds);
    }
    rgba
}

fn render_facets_with_border_points(
    width: u32,
    height: u32,
    facets: &[Facet],
    palette: &[[u8; 3]],
) -> Vec<u8> {
    let mut rgba = vec![248u8; (width as usize) * (height as usize) * 4];
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[3] = 255;
    }
    for facet in facets {
        let color = palette.get(facet.color_index).copied().unwrap_or([220, 220, 220]);
        let fill = tint_color(color, 0.82);
        for &(x, y) in &facet.pixels {
            set_pixel(&mut rgba, width, height, x as i32, y as i32, [fill[0], fill[1], fill[2], 255]);
        }
        for &(x, y) in &facet.border_points {
            set_pixel(&mut rgba, width, height, x as i32, y as i32, [32, 32, 32, 255]);
        }
    }
    rgba
}

fn draw_label_rect(rgba: &mut [u8], width: u32, height: u32, bounds: &LabelBounds) {
    let min_x = bounds.min_x as i32;
    let min_y = bounds.min_y as i32;
    let max_x = (bounds.min_x + bounds.width.saturating_sub(1)) as i32;
    let max_y = (bounds.min_y + bounds.height.saturating_sub(1)) as i32;
    for x in min_x..=max_x {
        set_pixel(rgba, width, height, x, min_y, [210, 0, 24, 255]);
        set_pixel(rgba, width, height, x, max_y, [210, 0, 24, 255]);
    }
    for y in min_y..=max_y {
        set_pixel(rgba, width, height, min_x, y, [210, 0, 24, 255]);
        set_pixel(rgba, width, height, max_x, y, [210, 0, 24, 255]);
    }
    let center_x = min_x + ((max_x - min_x) / 2);
    let center_y = min_y + ((max_y - min_y) / 2);
    for dx in -1..=1 {
        set_pixel(rgba, width, height, center_x + dx, center_y, [210, 0, 24, 255]);
    }
    for dy in -1..=1 {
        set_pixel(rgba, width, height, center_x, center_y + dy, [210, 0, 24, 255]);
    }
}

fn draw_loop_polyline(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    points: &[(f64, f64)],
    color: [u8; 4],
) {
    for segment in points.windows(2) {
        let start = segment[0];
        let end = segment[1];
        draw_line(
            rgba,
            width,
            height,
            start.0.round() as i32,
            start.1.round() as i32,
            end.0.round() as i32,
            end.1.round() as i32,
            color,
        );
    }
}

fn draw_line(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    mut x0: i32,
    mut y0: i32,
    x1: i32,
    y1: i32,
    color: [u8; 4],
) {
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut error = dx + dy;

    loop {
        set_pixel(rgba, width, height, x0, y0, color);
        if x0 == x1 && y0 == y1 {
            break;
        }
        let twice_error = error * 2;
        if twice_error >= dy {
            error += dy;
            x0 += sx;
        }
        if twice_error <= dx {
            error += dx;
            y0 += sy;
        }
    }
}

fn set_pixel(rgba: &mut [u8], width: u32, height: u32, x: i32, y: i32, color: [u8; 4]) {
    if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
        return;
    }
    let offset = flat_index(width, x as u32, y as u32) * 4;
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = color[3];
}

fn tint_color(color: [u8; 3], factor: f64) -> [u8; 3] {
    [
        ((color[0] as f64 * factor) + 255.0 * (1.0 - factor)).round().clamp(0.0, 255.0) as u8,
        ((color[1] as f64 * factor) + 255.0 * (1.0 - factor)).round().clamp(0.0, 255.0) as u8,
        ((color[2] as f64 * factor) + 255.0 * (1.0 - factor)).round().clamp(0.0, 255.0) as u8,
    ]
}
