use crate::contours::FacetContourData;
use crate::models::LabelBounds;
use crate::regions::Facet;
use tracing::debug;

/// 渲染 SVG。
///
/// 当前实现改为消费 tracer / segment / shared-edge 回放后的 contour 结果，
/// 保持多环 `evenodd`、二次曲线 `Q` 和描边填充策略不变。
pub fn render_svg_document(
    width: u32,
    height: u32,
    facets: &[Facet],
    contours: &[FacetContourData],
    palette: &[[u8; 3]],
    labels: &[LabelBounds],
    settings: &crate::models::ProcessSettings,
) -> String {
    let mut svg = String::new();
    svg.push_str(&format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">"#
    ).trim_end_matches('"'));
    svg.push_str(r#"<rect width="100%" height="100%" fill="white"/>"#);

    for facet in facets {
        let Some(contour_data) = contours.iter().find(|data| data.facet_id == facet.id) else {
            continue;
        };
        if contour_data.loops.is_empty() {
            continue;
        }

        let color = palette[facet.color_index];
        let mut path_data = String::new();
        for contour in &contour_data.loops {
            if contour.points.len() < 3 {
                continue;
            }

            let start = contour.points[0];
            path_data.push_str(&format!("M {} {} ", start.0, start.1));
            for index in 1..contour.points.len() {
                let current = contour.points[index - 1];
                let next = contour.points[index];
                let midpoint = ((current.0 + next.0) / 2.0, (current.1 + next.1) / 2.0);
                path_data.push_str(&format!(
                    "Q {} {} {} {} ",
                    midpoint.0, midpoint.1, next.0, next.1
                ));
            }
            path_data.push_str("Z ");
        }

        debug!(
            target: "pbn_core::render",
            facet_id = facet.id,
            subpath_count = contour_data.loops.len(),
            reconstructed_point_count = contour_data
                .loops
                .iter()
                .map(|loop_item| loop_item.points.len())
                .sum::<usize>(),
            raw_segment_count = contour_data.raw_segment_count,
            shared_segment_count = contour_data.shared_segment_count,
            reverse_segment_count = contour_data.reverse_segment_count,
            "Facet 路径回放完成"
        );

        let fill_attr = if settings.fill_facets {
            format!("rgb({},{},{})", color[0], color[1], color[2])
        } else {
            "none".to_string()
        };

        let stroke_attr = if settings.show_borders {
            "#222".to_string() // Dark border like web demo
        } else {
            "none".to_string()
        };
        let stroke_width = if settings.show_borders { "0.2" } else { "0" };

        svg.push_str(&format!(
            r#"<path data-facet-id="{}" d="{}" fill="{}" fill-rule="evenodd" stroke="{}" stroke-width="{}" stroke-linejoin="round"/>"#,
            facet.id,
            path_data.trim(),
            fill_attr,
            stroke_attr,
            stroke_width
        ));
    }

    if settings.show_labels {
        for (index, bounds) in labels.iter().enumerate() {
            let center_x = bounds.min_x as f64 + bounds.width as f64 / 2.0;
            let center_y = bounds.min_y as f64 + bounds.height as f64 / 2.0;
            let color_index = facets[index].color_index;
            svg.push_str(&format!(
                r#"<text x="{center_x}" y="{center_y}" font-size="4" text-anchor="middle" dominant-baseline="middle" fill="black">{color_index}</text>"#
            ));
        }
    }

    svg.push_str("</svg>");
    svg
}
