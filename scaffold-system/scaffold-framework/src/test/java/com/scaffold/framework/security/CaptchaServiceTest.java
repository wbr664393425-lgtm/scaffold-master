package com.scaffold.framework.security;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class CaptchaServiceTest {

    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> valueOperations = Mockito.mock(ValueOperations.class);

    private final StringRedisTemplate redisTemplate = Mockito.mock(StringRedisTemplate.class);

    CaptchaServiceTest() {
        Mockito.when(redisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    void generateReturnsPngImageAndNeverExposesTheAnswer() throws Exception {
        ArgumentCaptor<String> keyCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> valueCaptor = ArgumentCaptor.forClass(String.class);

        Map<String, String> captcha = newCaptchaService(true).generate();

        Mockito.verify(valueOperations).set(keyCaptor.capture(), valueCaptor.capture(),
                Mockito.eq(300L), Mockito.eq(TimeUnit.SECONDS));
        assertThat(captcha).containsOnlyKeys("captchaEnabled", "uuid", "img");
        assertThat(captcha).doesNotContainKey("code");
        assertThat(captcha.get("captchaEnabled")).isEqualTo("true");
        assertThat(captcha.get("uuid")).hasSize(32);
        assertThat(keyCaptor.getValue()).isEqualTo(CaptchaService.KEY_PREFIX + captcha.get("uuid"));

        String base64 = captcha.get("img");
        assertThat(base64).startsWith("data:image/png;base64,");
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(
                Base64.getDecoder().decode(base64.substring("data:image/png;base64,".length()))));
        assertThat(image).isNotNull();
        assertThat(image.getWidth()).isEqualTo(130);
        assertThat(image.getHeight()).isEqualTo(44);
    }

    @Test
    void verifyUsesStoredAnswerFromRedisAndClearsIt() {
        Mockito.when(valueOperations.get(CaptchaService.KEY_PREFIX + "uuid-1")).thenReturn("AB3D");
        CaptchaService service = newCaptchaService(true);

        assertThat(service.verify("uuid-1", "ab3d")).isTrue();
        Mockito.verify(redisTemplate).delete(CaptchaService.KEY_PREFIX + "uuid-1");
        assertThat(service.verify(null, "ab3d")).isFalse();
    }

    @Test
    void disabledCaptchaSkipsStorageAndVerification() {
        CaptchaService service = newCaptchaService(false);

        Map<String, String> captcha = service.generate();
        assertThat(captcha).containsOnlyKeys("captchaEnabled", "uuid", "img");
        assertThat(captcha.get("captchaEnabled")).isEqualTo("false");
        assertThat(captcha.get("img")).isNull();
        Mockito.verifyNoInteractions(valueOperations);
        assertThat(service.verify(null, null)).isTrue();
    }

    private CaptchaService newCaptchaService(boolean enabled) {
        return new CaptchaService(redisTemplate, enabled);
    }
}
