package com.scaffold.framework.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

/**
 * 图形验证码：答案只存 Redis，响应仅返回 base64 PNG 图片与 uuid，禁止回传明文验证码。
 */
@Service
public class CaptchaService {

    /** Redis key 前缀，测试夹具需要按同一前缀读取答案 */
    public static final String KEY_PREFIX = "captcha:";

    private static final long EXPIRE_SECONDS = 300;
    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 4;
    private static final int WIDTH = 130;
    private static final int HEIGHT = 44;
    private static final String PNG_DATA_PREFIX = "data:image/png;base64,";

    private final StringRedisTemplate redisTemplate;

    private final boolean enabled;

    public CaptchaService(
            StringRedisTemplate redisTemplate,
            @Value("${scaffold.security.captcha.enabled:true}") boolean enabled
    ) {
        this.redisTemplate = redisTemplate;
        this.enabled = enabled;
    }

    /**
     * 生成验证码图片。
     * 返回字段：captchaEnabled 是否启用验证码、uuid 校验标识、img 为 base64 PNG 图片（data 协议前缀已拼好）。
     */
    public Map<String, String> generate() {
        Map<String, String> result = new LinkedHashMap<>();
        if (!enabled) {
            result.put("captchaEnabled", "false");
            result.put("uuid", "");
            result.put("img", null);
            return result;
        }
        String uuid = UUID.randomUUID().toString().replace("-", "");
        String code = randomCode();
        redisTemplate.opsForValue().set(KEY_PREFIX + uuid, code, EXPIRE_SECONDS, TimeUnit.SECONDS);
        result.put("captchaEnabled", "true");
        result.put("uuid", uuid);
        result.put("img", PNG_DATA_PREFIX + renderBase64Png(code));
        return result;
    }

    public boolean verify(String uuid, String code) {
        if (!enabled) {
            return true;
        }
        if (uuid == null || code == null) return false;
        String key = KEY_PREFIX + uuid;
        String stored = redisTemplate.opsForValue().get(key);
        if (stored == null) return false;
        redisTemplate.delete(key);
        return stored.equalsIgnoreCase(code);
    }

    private String randomCode() {
        ThreadLocalRandom random = ThreadLocalRandom.current();
        StringBuilder code = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            code.append(CHARS.charAt(random.nextInt(CHARS.length())));
        }
        return code.toString();
    }

    /**
     * java.awt 无头模式渲染：随机底色 + 干扰线/噪点 + 逐字符旋转，不引入第三方验证码依赖。
     */
    private String renderBase64Png(String code) {
        ThreadLocalRandom random = ThreadLocalRandom.current();
        BufferedImage image = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = image.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            graphics.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 1f));
            graphics.setColor(new Color(246, 248, 251));
            graphics.fillRect(0, 0, WIDTH, HEIGHT);

            // 干扰线
            for (int i = 0; i < 4; i++) {
                graphics.setColor(randomColor(random, 160));
                graphics.drawLine(random.nextInt(WIDTH), random.nextInt(HEIGHT),
                        random.nextInt(WIDTH), random.nextInt(HEIGHT));
            }
            // 噪点
            for (int i = 0; i < 180; i++) {
                graphics.setColor(randomColor(random, 140));
                graphics.fillRect(random.nextInt(WIDTH), random.nextInt(HEIGHT), 1, 1);
            }

            int charWidth = (WIDTH - 20) / CODE_LENGTH;
            for (int i = 0; i < code.length(); i++) {
                AffineTransform original = graphics.getTransform();
                double angle = Math.toRadians(random.nextInt(-25, 26));
                double x = 12 + i * charWidth + random.nextInt(4);
                double y = HEIGHT / 2.0 + random.nextInt(-3, 4);
                graphics.rotate(angle, x, y);
                int fontSize = random.nextInt(24, 32);
                graphics.setFont(new Font(Font.SANS_SERIF, Font.BOLD, fontSize));
                graphics.setColor(randomColor(random, 60));
                graphics.drawString(String.valueOf(code.charAt(i)), (int) x, (int) (y + fontSize / 2.5));
                graphics.setTransform(original);
            }
        } finally {
            graphics.dispose();
        }

        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (!ImageIO.write(image, "png", out)) {
                throw new IllegalStateException("当前运行环境缺少 PNG 编码器，无法生成验证码图片");
            }
            return Base64.getEncoder().encodeToString(out.toByteArray());
        } catch (IOException ex) {
            throw new UncheckedIOException("验证码图片生成失败", ex);
        }
    }

    private Color randomColor(ThreadLocalRandom random, int maxBrightnessOffset) {
        int limit = Math.max(30, 255 - maxBrightnessOffset);
        return new Color(random.nextInt(limit), random.nextInt(limit), random.nextInt(limit));
    }
}
